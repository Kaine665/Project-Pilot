'use client';

import { useParams } from 'react-router';
import { DialogueView } from '@/components/dialogue-view';

export default function DialogueDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <DialogueView dialogueId={id!} />;
}
