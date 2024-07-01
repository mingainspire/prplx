'use client';

import type { Feedback } from '@/core/repositories/feedback';
import { fetcher } from '@/lib/fetch';
import { useState } from 'react';
import useSWR, { mutate } from 'swr';

export interface UseMessageFeedbackReturns {
  feedbackData: Feedback | undefined;
  disabled: boolean;

  source?: ContentSource;
  sourceLoading: boolean;

  feedback (action: 'like' | 'dislike', details: Record<string, 'like' | 'dislike'>, comment: string): Promise<void>;

  deleteFeedback (): Promise<void>;
}

export type ContentSource = {
  query: string
  markdownSources: {
    kgRelationshipUrls: string[]
    restUrls: string[]
  }
  kgSources: Record<string, any>
}

export function useMessageFeedback (chatId: number, messageId: number, enabled: boolean): UseMessageFeedbackReturns {
  const { data: feedback, isLoading, isValidating } = useSWR(enabled ? ['get', `/api/v1/chats/${chatId}/messages/${messageId}/feedback`] : undefined, fetcher<Feedback>);
  const [acting, setActing] = useState(false);
  const disabled = isValidating || isLoading || acting || !enabled;

  const contentData = useSWR((enabled && !disabled) ? ['get', `/api/v1/chats/${chatId}/messages/${messageId}/content-sources`] : undefined, fetcher<ContentSource>, { keepPreviousData: true, revalidateIfStale: false, revalidateOnReconnect: false });

  return {
    feedbackData: feedback,
    disabled,
    feedback: (action, detail, comment) => {
      setActing(true);
      return addFeedback(chatId, messageId, { action, knowledge_graph_detail: detail, comment }).finally(() => setActing(false));
    },
    deleteFeedback: () => {
      setActing(true);
      return deleteFeedback(chatId, messageId).finally(() => setActing(false));
    },
    source: contentData.data,
    sourceLoading: contentData.isLoading || contentData.isValidating,
  };
}

async function addFeedback (chatId: number, messageId: number, data: any) {
  await fetch(`/api/v1/chats/${chatId}/messages/${messageId}/feedback`, {
    method: 'post',
    body: JSON.stringify(data),
  });
  mutate(['get', `/api/v1/chats/${chatId}/messages/${messageId}/feedback`], data => data, true);
}

async function deleteFeedback (chatId: number, messageId: number) {
  await fetch(`/api/v1/chats/${chatId}/messages/${messageId}/feedback`, {
    method: 'delete',
  });
  mutate(['get', `/api/v1/chats/${chatId}/messages/${messageId}/feedback`], null, false);
}
