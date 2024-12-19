import { createKnowledgeBase } from '@/api/knowledge-base';
import { EmbeddingModelSelect, LLMSelect } from '@/components/form/biz';
import { FormInput, FormTextarea } from '@/components/form/control-widget';
import { withCreateEntityFormBeta } from '@/components/form/create-entity-form';
import { FormFieldBasicLayout } from '@/components/form/field-layout.beta';
import { FormIndexMethods } from '@/components/knowledge-base/form-index-methods';
import { mutateKnowledgeBases } from '@/components/knowledge-base/hooks';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { z } from 'zod';

const Form = withCreateEntityFormBeta(z.object({
  name: z.string().min(1),
  description: z.string(),
  index_methods: z.enum(['knowledge_graph', 'vector']).array(),
  llm_id: z.number().nullable().optional(),
  embedding_model_id: z.number().nullable().optional(),
  data_sources: z.never().array().length(0), // Use external page to create data source.
}), createKnowledgeBase);

export function CreateKnowledgeBaseForm ({}: {}) {
  const [transitioning, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Form
      transitioning={transitioning}
      onCreated={kb => {
        startTransition(() => {
          router.push(`/knowledge-bases/${kb.id}/data-sources`);
          router.refresh();
        });
        void mutateKnowledgeBases();
      }}
      defaultValues={{
        name: '',
        description: '',
        llm_id: undefined,
        data_sources: [],
        embedding_model_id: undefined,
        index_methods: ['vector'],
      }}
    >
      <FormFieldBasicLayout name="name" label="Name">
        <FormInput placeholder="The name of the knowledge base" />
      </FormFieldBasicLayout>
      <FormFieldBasicLayout name="description" label="Description">
        <FormTextarea placeholder="The description of the knowledge base" />
      </FormFieldBasicLayout>
      <FormFieldBasicLayout name="llm_id" label="LLM" description="Specify the LLM used in building the index. If not specified, the default model will be used.">
        <LLMSelect />
      </FormFieldBasicLayout>
      <FormFieldBasicLayout name="embedding_model_id" label="Embedding Model" description="Specify the embedding model used to convert the corpus into vector embedding. If not specified, the default model will be used.">
        <EmbeddingModelSelect />
      </FormFieldBasicLayout>
      <FormFieldBasicLayout name="index_methods" label="Index Methods">
        <FormIndexMethods />
      </FormFieldBasicLayout>
    </Form>
  );
}
