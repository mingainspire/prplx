'use client';

import { isSystemCheckPassed } from '@/api/system';
import { useAuth } from '@/components/auth/AuthProvider';
import { CreateDatasourceForm } from '@/components/datasource/CreateDatasourceForm';
import { DatasourceTypeTabs } from '@/components/datasource/DatasourceTypeTabs';
import type { DatasourceType } from '@/components/datasource/types';
import { CreateEmbeddingModelForm } from '@/components/embedding-model/CreateEmbeddingModelForm';
import { CreateLLMForm } from '@/components/llm/CreateLLMForm';
import { useSystemCheck } from '@/components/system/SystemCheckProvider';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowRightIcon, CircleAlertIcon, CircleCheckIcon } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { type ReactElement, useState, useTransition } from 'react';

export function SystemWizardDialog () {
  const pathname = usePathname();
  const sc = useSystemCheck();
  const [open, setOpen] = useState(() => !isSystemCheckPassed(sc));
  const router = useRouter();
  const [transitioning, startTransition] = useTransition();
  const [datasourceType, setDatasourceType] = useState<DatasourceType>('file');
  const { me } = useAuth();

  const configured = isSystemCheckPassed(sc);

  let el: ReactElement;

  if (!me) {
    el = (
      <>
        <DialogHeader>
          <DialogTitle>Almost there...</DialogTitle>
          <DialogDescription>Your app is not fully configured yet. Please complete the setup process.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={transitioning} onClick={() => startTransition(() => router.push('/auth/login'))}>Login to continue</Button>
        </DialogFooter>
      </>
    );
  } else {
    el = (
      <>
        <DialogHeader>
          <DialogTitle>
            {configured
              ? 'Successfully configured'
              : 'Almost there...'}
          </DialogTitle>
          <DialogDescription>
            {configured
              ? 'Congratulation! You have finished the setup process, it may take minutes to import datasource and build index.'
              : 'Your app is not fully configured yet. Please complete the setup process.'}
          </DialogDescription>
          <Accordion type="single" collapsible>
            <AccordionItem value="has_default_llm">
              <AccordionTrigger disabled={sc.has_default_llm}>
                  <span>
                    <StatusIcon flag={sc.has_default_llm} />
                    Setup default LLM
                  </span>
              </AccordionTrigger>
              {!sc.has_default_llm && <AccordionContent className="px-4">
                <CreateLLMForm
                  transitioning={transitioning}
                  onCreated={() => {
                    startTransition(() => {
                      router.refresh();
                    });
                  }}
                />
              </AccordionContent>}
            </AccordionItem>
            <AccordionItem value="has_default_embedding_model">
              <AccordionTrigger disabled={sc.has_default_embedding_model}>
                  <span>
                    <StatusIcon flag={sc.has_default_embedding_model} />
                    Setup default Embedding Model
                  </span>
              </AccordionTrigger>
              {!sc.has_default_embedding_model && <AccordionContent className="px-4">
                <CreateEmbeddingModelForm
                  transitioning={transitioning}
                  onCreated={() => {
                    startTransition(() => {
                      router.refresh();
                    });
                  }}
                />
              </AccordionContent>}
            </AccordionItem>
            <AccordionItem value="has_datasource">
              <AccordionTrigger disabled={sc.has_datasource}>
                  <span>
                    <StatusIcon flag={sc.has_datasource} />
                    Setup Datasource
                  </span>
              </AccordionTrigger>
              {!sc.has_datasource && (
                <AccordionContent className="px-4">
                  <DatasourceTypeTabs className="mb-4" type={datasourceType} onTypeChange={setDatasourceType} />
                  <CreateDatasourceForm
                    type={datasourceType}
                    transitioning={transitioning}
                    onCreated={() => {
                      startTransition(() => {
                        router.refresh();
                      });
                    }}
                  />
                </AccordionContent>
              )}
            </AccordionItem>
          </Accordion>
        </DialogHeader>
        {configured && <DialogFooter className="mt-2">
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
              router.push('/index-progress');
            }}
          >
            View Index Progress
            <ArrowRightIcon className="size-4 ml-1" />
          </Button>
          <Button onClick={() => setOpen(false)}>
            OK
          </Button>
        </DialogFooter>}
      </>
    );
  }

  return (
    <Dialog open={open && pathname !== '/auth/login' && !(!me && configured)}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-[50%] top-[50%] z-50 grid w-full max-w-screen-sm translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
          )}
        >
          <ScrollArea className="max-h-[80vh]">
            {el}
          </ScrollArea>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function StatusIcon ({ flag }: { flag: boolean }) {
  if (flag) {
    return (<CircleCheckIcon className="inline-block size-4 mr-2 text-green-500" />);
  } else {
    return (<CircleAlertIcon className="inline-block size-4 mr-2 text-yellow-500" />);
  }
}
