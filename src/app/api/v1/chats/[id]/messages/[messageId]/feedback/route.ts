import { getChat, getChatMessage } from '@/core/repositories/chat';
import { createFeedback, deleteFeedback, findFeedback } from '@/core/repositories/feedback';
import { getTraceId } from '@/core/services/feedback/utils';
import { defineHandler } from '@/lib/next/handler';
import { notFound } from 'next/navigation';
import z from 'zod';

export const GET = defineHandler(({
  params: z.object({
    id: z.coerce.number(),
    messageId: z.coerce.number(),
  }),
  auth: 'anonymous',
}), async ({ params, body, auth }) => {
  const chat = await getChat(params.id);
  const message = await getChatMessage(params.messageId);

  if (!chat || !message) {
    notFound();
  }

  if (!message.trace_url) {
    return Response.json({
      message: 'This conversation does not support knowledge graph feedback. (Langfuse link not recorded)',
    }, { status: 400 });
  }

  const userId = auth.user.id!;
  return await findFeedback(getTraceId(message.trace_url), userId);
});

export const POST = defineHandler(({
  params: z.object({
    id: z.coerce.number(),
    messageId: z.coerce.number(),
  }),
  body: z.object({
    action: z.enum(['like', 'dislike']),
    knowledge_graph_detail: z.record(z.enum(['like', 'dislike'])),
    comment: z.string(),
  }),
  auth: 'anonymous',
}), async ({ params, body, auth }) => {
  const chat = await getChat(params.id);
  const message = await getChatMessage(params.messageId);

  if (!chat || !message) {
    notFound();
  }

  if (!message.trace_url) {
    return Response.json({
      message: 'This conversation does not support knowledge graph feedback. (Langfuse link not recorded)',
    }, { status: 400 });
  }

  const traceId = getTraceId(message.trace_url);
  const userId = auth.user.id!;
  const feedback = await findFeedback(traceId, userId);

  // like whole answer

  if (feedback) {
    return Response.json({
      message: 'Already submitted feedback',
    }, { status: 400 });
  }

  await createFeedback({
    action: body.action,
    chat_id: params.id,
    message_id: params.messageId,
    knowledge_graph_detail: body.knowledge_graph_detail,
    created_by: userId,
    trace_id: getTraceId(message.trace_url),
    created_at: new Date(),
    comment: body.comment,
  });
});

export const DELETE = defineHandler({
  params: z.object({
    id: z.coerce.number(),
    messageId: z.coerce.number(),
  }),
  auth: 'anonymous',
}, async ({ params, auth }) => {
  const chat = await getChat(params.id);
  const message = await getChatMessage(params.messageId);

  if (!chat || !message) {
    notFound();
  }

  if (!message.trace_url) {
    return Response.json({
      message: 'This conversation does not support knowledge graph feedback. (Langfuse link not recorded)',
    }, { status: 400 });
  }

  const traceId = getTraceId(message.trace_url);
  const userId = auth.user.id!;
  const feedback = await findFeedback(traceId, userId);

  if (feedback) {
    await deleteFeedback(feedback.id);
  }
});

export const dynamic = 'force-dynamic';
