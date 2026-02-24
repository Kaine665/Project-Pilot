import { FileText } from 'lucide-react';

export default function TasksPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-zinc-400">
        <FileText className="h-12 w-12 stroke-1" />
        <p className="text-sm">选择一个任务开始</p>
      </div>
    </div>
  );
}
