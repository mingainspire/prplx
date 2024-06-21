import type { ConversationMessageGroupProps } from '@/components/chat/use-grouped-conversation-messages';
import { RemarkContent } from '@/components/remark-content';
import './style.css';

export function MessageContent ({ group }: { group: ConversationMessageGroupProps }) {
  return (
    <article className="remark-content prose prose-sm prose-neutral dark:prose-invert overflow-x-hidden break-words max-w-[unset]">
      {group.assistantMessage?.content && <RemarkContent>
        {group.assistantMessage.content}
      </RemarkContent>}
    </article>
  );
}