'use client';

import { use } from 'react';
import { DialogueView } from '@/components/dialogue-view';

export default function DialogueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <DialogueView dialogueId={id} />;
}
