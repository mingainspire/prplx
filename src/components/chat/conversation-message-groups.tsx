import { useMyChatContext } from '@/components/chat/context';
import { MessageAnnotation } from '@/components/chat/message-annotation';
import { MessageContent } from '@/components/chat/message-content';
import { MessageContextSources } from '@/components/chat/message-content-sources';
import { MessageError } from '@/components/chat/message-error';
import { MessageHeading } from '@/components/chat/message-heading';
import { MessageOperations } from '@/components/chat/message-operations';
import { type ConversationMessageGroupProps, useGroupedConversationMessages } from '@/components/chat/use-grouped-conversation-messages';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ChatMessage } from '@/core/repositories/chat';
import { getErrorMessage } from '@/lib/errors';
import { AlertTriangleIcon } from 'lucide-react';

export function ConversationMessageGroups ({ history }: { history: ChatMessage[] }) {
  const { error, messages, isLoading, isWaiting } = useMyChatContext();
  const groups = useGroupedConversationMessages(history, messages, isLoading || isWaiting, error);

  return (
    <div className="space-y-8">
      {groups.map(group => (
        <ConversationMessageGroup key={group.id} group={group} />
      ))}
      {!!error && <Alert variant="destructive">
        <AlertTriangleIcon />
        <AlertTitle>Fail to chat with TiDB.ai</AlertTitle>
        <AlertDescription>{getErrorMessage(error)}</AlertDescription>
      </Alert>}
    </div>
  );
}

function ConversationMessageGroup ({ group }: { group: ConversationMessageGroupProps }) {
  return (
    <section className="space-y-6 p-4 border-b pb-10 last-of-type:border-b-0 last-of-type:border-pb-4">
      <h2 className="text-2xl font-normal">{group.userMessage.content}</h2>
      <MessageContextSources group={group} />
      <section className="space-y-2">
        <MessageHeading />
        <MessageError group={group} />
        <MessageContent group={group} />
        <MessageAnnotation group={group} />
      </section>
      <MessageOperations group={group} />
    </section>
  );
}
