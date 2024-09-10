import time
import logging
from uuid import UUID
from typing import List, Generator, Optional, Tuple
from datetime import datetime, UTC

import jinja2
from sqlmodel import Session, select, func
from llama_index.core import VectorStoreIndex, ServiceContext
from llama_index.core.base.llms.base import ChatMessage
from llama_index.core.prompts.base import PromptTemplate
from llama_index.core.base.response.schema import StreamingResponse
from llama_index.core.callbacks.schema import EventPayload
from llama_index.core.callbacks import CallbackManager
from langfuse import Langfuse
from langfuse.llama_index import LlamaIndexCallbackHandler

from app.models import (
    User,
    Document,
    Chunk,
    Chat as DBChat,
    ChatMessage as DBChatMessage,
    LLM as DBLLM,
    EmbeddingModel as DBEmbeddingModel,
    DataSource as DBDataSource,
    RerankerModel as DBRerankerModel,
)
from app.core.config import settings
from app.rag.chat_stream_protocol import (
    ChatStreamMessagePayload,
    ChatStreamDataPayload,
    ChatEvent,
)
from app.rag.vector_store.tidb_vector_store import TiDBVectorStore
from app.rag.knowledge_graph.graph_store import TiDBGraphStore, tidb_graph_editor as editor
from app.rag.knowledge_graph import KnowledgeGraphIndex
from app.rag.chat_config import ChatEngineConfig, get_default_embedding_model
from app.rag.types import (
    MyCBEventType,
    ChatMessageSate,
    ChatEventType,
    MessageRole,
)
from app.repositories import chat_repo
from app.site_settings import SiteSetting

logger = logging.getLogger(__name__)


class ChatService:
    def __init__(
        self,
        db_session: Session,
        user: User,
        browser_id: str,
        engine_name: str = "default",
    ) -> None:
        self.db_session = db_session
        self.user = user
        self.browser_id = browser_id
        self.engine_name = engine_name

        self.chat_engine_config = ChatEngineConfig.load_from_db(db_session, engine_name)
        self.db_chat_engine = self.chat_engine_config.get_db_chat_engine()
        self._reranker = self.chat_engine_config.get_reranker(db_session)
        self._metadata_filter = self.chat_engine_config.get_metadata_filter()
        if self._reranker:
            self._node_postprocessors = [self._metadata_filter, self._reranker]
            # Set initial similarity_top_k to a large number,
            # reranker will filter out irrelevant nodes after the retrieval
            self._similarity_top_k = 80
        else:
            self._node_postprocessors = [self._metadata_filter]
            self._similarity_top_k = 10

        self.langfuse_host = SiteSetting.langfuse_host
        self.langfuse_secret_key = SiteSetting.langfuse_secret_key
        self.langfuse_public_key = SiteSetting.langfuse_public_key
        self.enable_langfuse = (
            self.langfuse_host and self.langfuse_secret_key and self.langfuse_public_key
        )

    def chat(
        self, chat_messages: List[ChatMessage], chat_id: Optional[UUID] = None
    ) -> Generator[ChatEvent, None, None]:
        try:
            for event in self._chat(chat_messages, chat_id):
                yield event
        except Exception as e:
            logger.exception(e)
            yield ChatEvent(
                event_type=ChatEventType.ERROR_PART,
                payload="Encountered an error while processing the chat. Please try again later.",
            )

    def _chat(
        self, chat_messages: List[ChatMessage], chat_id: Optional[UUID] = None
    ) -> Generator[ChatEvent, None, None]:
        user_question, chat_history = self._parse_chat_messages(chat_messages)

        if chat_id:
            # FIXME:
            #   only chat owner or superuser can access the chat,
            #   anonymous user can only access anonymous chat by track_id
            self.db_chat_obj = chat_repo.get(self.db_session, chat_id)
            if not self.db_chat_obj:
                yield ChatEvent(
                    event_type=ChatEventType.ERROR_PART,
                    payload="Chat not found",
                )
                return
            chat_history = [
                ChatMessage(role=m.role, content=m.content, additional_kwargs={})
                for m in chat_repo.get_messages(self.db_session, self.db_chat_obj)
            ]
        else:
            self.db_chat_obj = chat_repo.create(
                self.db_session,
                DBChat(
                    title=user_question[:100],
                    engine_id=self.db_chat_engine.id,
                    engine_options=self.chat_engine_config.screenshot(),
                    user_id=self.user.id if self.user else None,
                    browser_id=self.browser_id,
                ),
            )
            chat_id = self.db_chat_obj.id
            # slack/discord may create a new chat with history messages
            now = datetime.now(UTC)
            for i, m in enumerate(chat_history):
                chat_repo.create_message(
                    session=self.db_session,
                    chat=self.db_chat_obj,
                    chat_message=DBChatMessage(
                        role=m.role,
                        content=m.content,
                        ordinal=i + 1,
                        created_at=now,
                        updated_at=now,
                        finished_at=now,
                    ),
                )

        if self.enable_langfuse:
            langfuse = Langfuse(
                host=self.langfuse_host,
                secret_key=self.langfuse_secret_key,
                public_key=self.langfuse_public_key,
            )
            observation = langfuse.trace(
                name="chat",
                user_id=self.user.email
                if self.user
                else f"anonymous-{self.browser_id}",
                metadata={
                    "chat_engine_config": self.chat_engine_config.screenshot(),
                },
                tags=[f"chat_engine:{self.engine_name}"],
                release=settings.ENVIRONMENT,
                input={
                    "user_question": user_question,
                    "chat_history": chat_history,
                },
            )
            trace_id = observation.trace_id
            trace_url = observation.get_trace_url()
        else:
            trace_id = ""
            trace_url = ""

        db_user_message = chat_repo.create_message(
            session=self.db_session,
            chat=self.db_chat_obj,
            chat_message=DBChatMessage(
                role=MessageRole.USER.value,
                trace_url=trace_url,
                content=user_question,
            ),
        )
        db_assistant_message = chat_repo.create_message(
            session=self.db_session,
            chat=self.db_chat_obj,
            chat_message=DBChatMessage(
                role=MessageRole.ASSISTANT.value,
                trace_url=trace_url,
                content="",
            ),
        )

        _embed_model = get_default_embedding_model(self.db_session)
        _llm = self.chat_engine_config.get_llama_llm(self.db_session)
        _fast_llm = self.chat_engine_config.get_fast_llama_llm(self.db_session)
        _fast_dspy_lm = self.chat_engine_config.get_fast_dspy_lm(self.db_session)

        def _get_llamaindex_callback_manager():
            # Why we don't use high-level decorator `observe()` as \
            #   `https://langfuse.com/docs/integrations/llama-index/get-started` suggested?
            # track:
            #   - https://github.com/langfuse/langfuse/issues/2015
            #   - https://langfuse.com/blog/2024-04-python-decorator
            if self.enable_langfuse:
                observation = langfuse.trace(id=trace_id)
                langfuse_handler = LlamaIndexCallbackHandler()
                langfuse_handler.set_root(observation)
                callback_manager = CallbackManager([langfuse_handler])
            else:
                callback_manager = CallbackManager([])
            _llm.callback_manager = callback_manager
            _fast_llm.callback_manager = callback_manager
            _embed_model.callback_manager = callback_manager
            return callback_manager

        # Frontend requires the empty event to start the chat
        yield ChatEvent(
            event_type=ChatEventType.TEXT_PART,
            payload="",
        )
        yield ChatEvent(
            event_type=ChatEventType.DATA_PART,
            payload=ChatStreamDataPayload(
                chat=self.db_chat_obj,
                user_message=db_user_message,
                assistant_message=db_assistant_message,
            ),
        )

        # 1. Retrieve entities, relations, and chunks from the knowledge graph
        kg_config = self.chat_engine_config.knowledge_graph
        if kg_config.enabled:
            graph_store = TiDBGraphStore(
                dspy_lm=_fast_dspy_lm,
                session=self.db_session,
                embed_model=_embed_model,
            )
            graph_index: KnowledgeGraphIndex = KnowledgeGraphIndex.from_existing(
                dspy_lm=_fast_dspy_lm,
                kg_store=graph_store,
                callback_manager=_get_llamaindex_callback_manager(),
            )

            if kg_config.using_intent_search:
                yield ChatEvent(
                    event_type=ChatEventType.MESSAGE_ANNOTATIONS_PART,
                    payload=ChatStreamMessagePayload(
                        state=ChatMessageSate.KG_RETRIEVAL,
                        display="Identifying Your Question's Core Intents",
                    ),
                )
                graph_index._callback_manager = _get_llamaindex_callback_manager()
                intent_relationships = graph_index.intent_analyze(
                    user_question,
                    chat_history,
                )
                yield ChatEvent(
                    event_type=ChatEventType.MESSAGE_ANNOTATIONS_PART,
                    payload=ChatStreamMessagePayload(
                        state=ChatMessageSate.TRACE,
                        display="Searching the Knowledge Graph for Relevant Context",
                        context={"langfuse_url": trace_url},
                    ),
                )
                graph_index._callback_manager = _get_llamaindex_callback_manager()
                result = graph_index.intent_based_search(
                    intent_relationships,
                    include_meta=True,
                    relationship_meta_filters=kg_config.relationship_meta_filters,
                )

                entities = result["graph"]["entities"]
                relations = result["graph"]["relationships"]
                graph_data_source_ids = {
                    "entities": [e["id"] for e in entities],
                    "relationships": [r["id"] for r in relations],
                }

                graph_knowledges = get_prompt_by_jinja2_template(
                    self.chat_engine_config.llm.intent_graph_knowledge,
                    sub_queries=result["queries"],
                )
                graph_knowledges_context = graph_knowledges.template
            else:
                yield ChatEvent(
                    event_type=ChatEventType.MESSAGE_ANNOTATIONS_PART,
                    payload=ChatStreamMessagePayload(
                        state=ChatMessageSate.TRACE,
                        display="Searching the Knowledge Graph for Relevant Context",
                        context={"langfuse_url": trace_url},
                    ),
                )
                graph_index._callback_manager = _get_llamaindex_callback_manager()
                entities, relations, chunks = graph_index.retrieve_with_weight(
                    user_question,
                    [],
                    depth=kg_config.depth,
                    include_meta=kg_config.include_meta,
                    with_degree=kg_config.with_degree,
                    relationship_meta_filters=kg_config.relationship_meta_filters,
                    with_chunks=False,
                )
                graph_data_source_ids = {
                    "entities": [e["id"] for e in entities],
                    "relationships": [r["id"] for r in relations],
                }
                graph_knowledges = get_prompt_by_jinja2_template(
                    self.chat_engine_config.llm.normal_graph_knowledge,
                    entities=entities,
                    relationships=relations,
                )
                graph_knowledges_context = graph_knowledges.template
        else:
            entities, relations, chunks = [], [], []
            graph_data_source_ids = {}
            graph_knowledges_context = ""

        # 2. Refine the user question using graph information and chat history
        yield ChatEvent(
            event_type=ChatEventType.MESSAGE_ANNOTATIONS_PART,
            payload=ChatStreamMessagePayload(
                state=ChatMessageSate.REFINE_QUESTION,
                display="Query Rewriting for Enhanced Information Retrieval",
            ),
        )
        callback_manager = _get_llamaindex_callback_manager()
        with callback_manager.as_trace("condense_question"):
            with callback_manager.event(
                MyCBEventType.CONDENSE_QUESTION,
                payload={EventPayload.QUERY_STR: user_question},
            ) as event:
                refined_question = _fast_llm.predict(
                    get_prompt_by_jinja2_template(
                        self.chat_engine_config.llm.condense_question_prompt,
                        graph_knowledges=graph_knowledges_context,
                        chat_history=chat_history,
                        question=user_question,
                    ),
                )
                event.on_end(payload={EventPayload.COMPLETION: refined_question})
        yield ChatEvent(
            event_type=ChatEventType.MESSAGE_ANNOTATIONS_PART,
            payload=ChatStreamMessagePayload(
                state=ChatMessageSate.REFINE_QUESTION,
                message=refined_question,
            ),
        )

        # 3. Retrieve the related chunks from the vector store
        # 4. Rerank after the retrieval
        # 5. Generate a response using the refined question and related chunks
        yield ChatEvent(
            event_type=ChatEventType.MESSAGE_ANNOTATIONS_PART,
            payload=ChatStreamMessagePayload(
                state=ChatMessageSate.SEARCH_RELATED_DOCUMENTS,
                display="Retrieving and Reranking the Best-Matching Data"
                if self._reranker
                else "Retrieving the Most Relevant Data",
            ),
        )
        callback_manager = _get_llamaindex_callback_manager()
        text_qa_template = get_prompt_by_jinja2_template(
            self.chat_engine_config.llm.text_qa_prompt,
            graph_knowledges=graph_knowledges_context,
            original_question=user_question,
        )
        refine_template = get_prompt_by_jinja2_template(
            self.chat_engine_config.llm.refine_prompt,
            graph_knowledges=graph_knowledges_context,
            original_question=user_question,
        )
        service_context = ServiceContext.from_defaults(
            llm=_llm,
            embed_model=_embed_model,
            callback_manager=callback_manager,
        )
        vector_store = TiDBVectorStore(session=self.db_session)
        vector_index = VectorStoreIndex.from_vector_store(
            vector_store,
            service_context=service_context,
        )
        query_engine = vector_index.as_query_engine(
            llm=_llm,
            node_postprocessors=self._node_postprocessors,
            streaming=True,
            text_qa_template=text_qa_template,
            refine_template=refine_template,
            similarity_top_k=self._similarity_top_k,
            service_context=service_context,
        )
        response: StreamingResponse = query_engine.query(refined_question)
        source_documents = self._get_source_documents(response)

        yield ChatEvent(
            event_type=ChatEventType.MESSAGE_ANNOTATIONS_PART,
            payload=ChatStreamMessagePayload(
                state=ChatMessageSate.SOURCE_NODES,
                context=source_documents,
            ),
        )
        yield ChatEvent(
            event_type=ChatEventType.MESSAGE_ANNOTATIONS_PART,
            payload=ChatStreamMessagePayload(
                state=ChatMessageSate.GENERATE_ANSWER,
                display="Generating a Precise Answer with AI",
            ),
        )

        response_text = ""
        for word in response.response_gen:
            response_text += word
            yield ChatEvent(
                event_type=ChatEventType.TEXT_PART,
                payload=word,
            )

        if not response_text:
            raise Exception("Got empty response from LLM")

        db_assistant_message.sources = source_documents
        # db_assistant_message.graph_data = graph_data_source_ids
        db_assistant_message.content = response_text
        db_assistant_message.updated_at = datetime.now(UTC)
        db_assistant_message.finished_at = datetime.now(UTC)
        self.db_session.add(db_assistant_message)
        # db_user_message.graph_data = graph_data_source_ids
        logger.info(f"graph_data_source_ids({type(graph_data_source_ids)}): {graph_data_source_ids}")
        logger.info(f"source_documents({type(source_documents)}): {source_documents}")
        self.db_session.add(db_user_message)
        self.db_session.commit()

        yield ChatEvent(
            event_type=ChatEventType.MESSAGE_ANNOTATIONS_PART,
            payload=ChatStreamMessagePayload(
                state=ChatMessageSate.FINISHED,
            ),
        )

        yield ChatEvent(
            event_type=ChatEventType.DATA_PART,
            payload=ChatStreamDataPayload(
                chat=self.db_chat_obj,
                user_message=db_user_message,
                assistant_message=db_assistant_message,
            ),
        )

    def _parse_chat_messages(
        self, chat_messages: List[ChatMessage]
    ) -> tuple[str, List[ChatMessage]]:
        user_question = chat_messages[-1].content
        chat_history = chat_messages[:-1]
        return user_question, chat_history

    def _get_source_documents(self, response: StreamingResponse) -> List[dict]:
        source_nodes_ids = [s_n.node_id for s_n in response.source_nodes]
        stmt = (
            select(
                Chunk.id,
                Document.id,
                Document.name,
                Document.source_uri,
            )
            .outerjoin(Document, Chunk.document_id == Document.id)
            .where(
                Chunk.id.in_(source_nodes_ids),
            )
        )
        source_chunks = self.db_session.exec(stmt).all()
        # Sort the source chunks based on the order of the source_nodes_ids, which are arranged according to their related scores.
        source_chunks = sorted(
            source_chunks, key=lambda x: source_nodes_ids.index(str(x[0]))
        )
        source_documents = []
        source_documents_ids = []
        for s in source_chunks:
            if s[1] not in source_documents_ids:
                source_documents_ids.append(s[1])
                source_documents.append(
                    {
                        "id": s[1],
                        "name": s[2],
                        "source_uri": s[3],
                    }
                )
        return source_documents


def get_prompt_by_jinja2_template(template_string: str, **kwargs) -> PromptTemplate:
    # use jinja2's template because it support complex render logic
    # for example:
    #       {% for e in entities %}
    #           {{ e.name }}
    #       {% endfor %}
    template = (
        jinja2.Template(template_string)
        .render(**kwargs)
        # llama-index will use f-string to format the template
        # so we need to escape the curly braces even if we do not use it
        .replace("{", "{{")
        .replace("}", "}}")
        # This is a workaround to bypass above escape,
        # llama-index will use f-string to format following variables,
        # maybe we can use regex to replace the variable name to make this more robust
        .replace("<<query_str>>", "{query_str}")
        .replace("<<context_str>>", "{context_str}")
        .replace("<<existing_answer>>", "{existing_answer}")
        .replace("<<context_msg>>", "{context_msg}")
    )
    return PromptTemplate(template=template)


def user_can_view_chat(chat: DBChat, user: Optional[User]) -> bool:
    # Anonymous chat can be accessed by anyone
    # Chat with owner can only be accessed by owner or superuser
    if chat.user_id and not (user and (user.is_superuser or chat.user_id == user.id)):
        return False
    return True


def get_graph_data_from_langfuse(trace_url: str):
    start_time = time.time()
    langfuse_host = SiteSetting.langfuse_host
    langfuse_secret_key = SiteSetting.langfuse_secret_key
    langfuse_public_key = SiteSetting.langfuse_public_key
    enable_langfuse = (
        langfuse_host and langfuse_secret_key and langfuse_public_key
    )
    current_time = time.time()
    logger.debug(f"Graph Load - Fetch langfuse configs from site setting, time cost: {current_time - start_time}s")
    logger.debug(f"Graph Load - trace_url: {trace_url}, enable_langfuse: {enable_langfuse}")
    start_time = current_time
    if enable_langfuse and trace_url is not None and trace_url != "":
        langfuse_client = Langfuse(
            secret_key=langfuse_secret_key,
            public_key=langfuse_public_key,
            host=langfuse_host
        )
        trace_id = trace_url.split("/trace/")[-1]
        ob_data = langfuse_client.fetch_observations(trace_id=trace_id)
        current_time = time.time()
        logger.debug(f"Graph Load - Fetch trace({trace_id}) from langfuse, time cost: {current_time - start_time}s")
        start_time = current_time
        all_entities = []
        all_relationships = []

        for obd in ob_data.data:
            if obd.name == MyCBEventType.GRAPH_SEMANTIC_SEARCH:
                for _, sg in obd.output['queries'].items():
                    all_entities.extend(sg['entities'])
                    all_relationships.extend(sg['relationships'])

        unique_entities = {e["id"]: e for e in all_entities}.values()
        unique_relationships = {r["id"]: r for r in all_relationships}.values()

        logger.debug(
            f"Graph Load - Fetch trace({trace_id}) from langfuse, relationships: {len(unique_relationships)}, time cost: {time.time() - start_time}s"
        )

        return list(unique_entities), list(unique_relationships)
    else:
        return [], []


def get_chat_message_subgraph(
    session: Session, chat_message: DBChatMessage
) -> Tuple[List, List]:
    if chat_message.role != MessageRole.USER:
        return [], []

    # try to get subgraph from chat_message.graph_data
    try:
        if (
            chat_message.graph_data
            and "relationships" in chat_message.graph_data
            and len(chat_message.graph_data["relationships"]) > 0
        ):
            relationship_ids = chat_message.graph_data["relationships"]
            all_entities, all_relationships = editor.get_relationship_by_ids(
                session,
                relationship_ids
            )
            entities = [
                {
                    "id": e.id,
                    "name": e.name,
                    "description": e.description,
                    "meta": e.meta,
                    "entity_type": e.entity_type,
                }
                for e in all_entities
            ]
            relationships = [
                {
                    "id": r.id,
                    "source_entity_id": r.source_entity_id,
                    "target_entity_id": r.target_entity_id,
                    "description": r.description,
                    "rag_description": f"{r.source_entity.name} -> {r.description} -> {r.target_entity.name}",
                    "meta": r.meta,
                    "weight": r.weight,
                    "last_modified_at": r.last_modified_at,
                }
                for r in all_relationships
            ]
            return entities, relationships
    except Exception as e:
        logger.error(f"Failed to get subgraph from chat_message.graph_data: {e}")

    # try to get subgraph from langfuse trace
    try:
        entities, relationships = get_graph_data_from_langfuse(
            chat_message.trace_url
        )
        if len(relationships) > 0:
            return list(entities), list(relationships)
    except Exception as e:
        logger.error(f"Failed to get subgraph from langfuse trace: {e}")

    chat: DBChat = chat_message.chat
    chat_engine_config = ChatEngineConfig.load_from_db(session, chat.engine.name)
    kg_config = chat_engine_config.knowledge_graph
    graph_store = TiDBGraphStore(
        dspy_lm=chat_engine_config.get_fast_dspy_lm(session),
        session=session,
        embed_model=get_default_embedding_model(session),
    )
    entities, relations, _ = graph_store.retrieve_with_weight(
        chat_message.content,
        [],
        depth=kg_config.depth,
        include_meta=kg_config.include_meta,
        with_degree=kg_config.with_degree,
        with_chunks=False,
    )
    return entities, relations


def check_rag_required_config(session: Session) -> tuple[bool]:
    # Check if llm, embedding model, and datasource are configured
    # If any of them is missing, the rag can not work
    has_default_llm = session.scalar(select(func.count(DBLLM.id))) > 0
    has_default_embedding_model = (
        session.scalar(select(func.count(DBEmbeddingModel.id))) > 0
    )
    has_datasource = session.scalar(select(func.count(DBDataSource.id))) > 0
    return has_default_llm, has_default_embedding_model, has_datasource


def check_rag_optional_config(session: Session) -> tuple[bool]:
    langfuse = bool(
        SiteSetting.langfuse_host
        and SiteSetting.langfuse_secret_key
        and SiteSetting.langfuse_public_key
    )
    default_reranker = session.scalar(select(func.count(DBRerankerModel.id))) > 0
    return langfuse, default_reranker
