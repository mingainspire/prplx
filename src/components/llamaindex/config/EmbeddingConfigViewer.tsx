import { useIndexConfigPart } from '@/components/llamaindex/config/use-index-config-part';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { Index } from '@/core/repositories/index_';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const schema = z.object({
  provider: z.string(),
  config: z.object({
    model: z.string(),
    vectorColumn: z.literal('embedding').default('embedding'),
    vectorDimension: z.coerce.number(),
  })
});

export function EmbeddingConfigViewer ({ index }: { index: Index }) {
  const { data: embedding, update: updateEmbedding, isUpdating, isLoading } = useIndexConfigPart(index, 'embedding');
  const disabled = !!index.configured || isLoading || isUpdating;
  const form = useForm({
    values: embedding,
    disabled,
    resolver: zodResolver(schema),
  });

  const handleSubmit = form.handleSubmit((value) => {
    updateEmbedding(value);
  });

  useEffect(() => {
    if (!isLoading && embedding) {
      form.reset(embedding);
    }
  }, [isLoading, embedding]);

  return (
    <form onSubmit={handleSubmit}>
      <Form {...form}>
        <FormField
          control={form.control}
          name="provider"
          render={({ field }) => (
            <FormItem>
              <FormLabel>EMBEDDING Provider</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="config.model"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Model Name</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="config.vectorDimension"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Vector Dimensions</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button className="mt-4" disabled={disabled}>Submit</Button>
      </Form>
    </form>
  );
}