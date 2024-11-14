import type { CreateKnowledgeBaseParams } from '@/api/knowledge-base';
import type { FormControlWidgetProps } from '@/components/form/control-widget';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { forwardRef, type ReactNode, useId } from 'react';

export const FormIndexMethods = forwardRef<any, FormControlWidgetProps<CreateKnowledgeBaseParams, 'index_methods'>>(({ value, onChange }, ref) => {
  return (
    <div className="space-y-2" ref={ref}>
      <IndexMethod
        label="Vector Index"
        description="Vector Index is enabled by default"
        disabled
        checked={value?.includes('vector') ?? false}
        onCheckedChange={checked => {
          const set = new Set(value);
          if (checked) {
            set.add('vector');
          } else {
            set.delete('vector');
          }
          onChange?.(Array.from(set));
        }}
      />
      <IndexMethod
        label="Graph Index"
        description="Graph Index"
        checked={value?.includes('knowledge_graph') ?? false}
        onCheckedChange={checked => {
          const set = new Set(value);
          if (checked) {
            // graph index requires vector index.
            set.add('vector');
            set.add('knowledge_graph');
          } else {
            set.delete('knowledge_graph');
          }
          onChange?.(Array.from(set));
        }}
      />
    </div>
  );
});

FormIndexMethods.displayName = 'FormIndexMethods';

function IndexMethod ({ disabled, label, description, checked, onCheckedChange }: { disabled?: boolean, label: ReactNode, description: ReactNode, checked: boolean, onCheckedChange: (value: boolean) => void }) {
  const id = useId();

  return (
    <div className="flex flex-row items-center justify-between rounded-lg border p-4">
      <div className="space-y-0.5">
        <Label id={`${id}-label`} className="text-base" htmlFor={id}>
          {label}
        </Label>
        <p id={`${id}-description`} className="text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        disabled={disabled}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-description`}
      />
    </div>
  );
}