import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi_pagination import Params, Page

from app.api.admin_routes.knowledge_base.models import ChunkItem
from app.api.deps import SessionDep, CurrentSuperuserDep
from app.models.chunk import get_kb_chunk_model
from app.models.entity import get_kb_entity_model
from app.models.relationship import get_kb_relationship_model
from app.repositories import knowledge_base_repo, document_repo
from app.repositories.chunk import ChunkRepo
from app.api.admin_routes.knowledge_base.document.models import (
    DocumentFilters,
    DocumentItem
)
from app.exceptions import (
    InternalServerError,
    KBNotFound,
)
from app.repositories.graph import GraphRepo
from app.tasks import (
    build_index_for_document,
    build_kg_index_for_chunk
)
from app.tasks.knowledge_base import (
    stats_for_knowledge_base
)


router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/admin/knowledge_bases/{kb_id}/documents")
def list_kb_documents(
    session: SessionDep,
    user: CurrentSuperuserDep,
    kb_id: int,
    filters: Annotated[DocumentFilters, Query()],
    params: Params = Depends(),
) -> Page[DocumentItem]:
    try:
        kb = knowledge_base_repo.must_get(session, kb_id)
        filters.knowledge_base_id = kb.id
        return document_repo.paginate(
            session=session,
            filters=filters,
            params=params,
        )
    except KBNotFound as e:
        raise e
    except Exception as e:
        logger.exception(e)
        raise InternalServerError()


@router.get("/admin/knowledge_bases/{kb_id}/documents/{doc_id}/chunks")
def list_kb_document_chunks(
    session: SessionDep,
    user: CurrentSuperuserDep,
    kb_id: int,
    doc_id: int,
) -> list[ChunkItem]:
    try:
        kb = knowledge_base_repo.must_get(session, kb_id)
        chunk_repo = ChunkRepo(get_kb_chunk_model(kb))
        return chunk_repo.get_document_chunks(session, doc_id)
    except KBNotFound as e:
        raise e
    except Exception as e:
        logger.exception(e)
        raise InternalServerError()


@router.delete("/admin/knowledge_bases/{kb_id}/documents/{document_id}")
def remove_kb_document(
    session: SessionDep,
    user: CurrentSuperuserDep,
    kb_id: int,
    document_id: int,
):
    try:
        kb = knowledge_base_repo.must_get(session, kb_id)
        doc = document_repo.must_get(session, document_id)
        assert doc.knowledge_base_id == kb.id

        chunk_model = get_kb_chunk_model(kb)
        entity_model = get_kb_entity_model(kb)
        relationship_model = get_kb_relationship_model(kb)

        chunk_repo = ChunkRepo(chunk_model)
        graph_repo = GraphRepo(entity_model, relationship_model)

        graph_repo.delete_document_relationships(session, document_id)
        logger.info(f"Deleted relationships generated by document #{document_id} successfully.")

        graph_repo.delete_orphaned_entities(session)
        logger.info(f"Deleted orphaned entities successfully.")

        chunk_repo.delete_by_document(session, document_id)
        logger.info(f"Deleted chunks of document #{document_id} successfully.")

        session.delete(doc)
        session.commit()

        stats_for_knowledge_base.delay(kb_id)

        return {
            "detail": "success"
        }
    except KBNotFound as e:
        raise e
    except Exception as e:
        logger.exception(f"Failed to remove document #{document_id}: {e}")
        raise InternalServerError()