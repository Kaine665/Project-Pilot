'use client';

import { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import type { ProjectConfig } from '@/types';
import { Settings, Plus, Trash2, X, FolderOpen } from 'lucide-react';

const projectTypes = [
  { value: 'react-native', label: 'React Native' },
  { value: 'nextjs', label: 'Next.js' },
  { value: 'node', label: 'Node.js' },
  { value: 'python', label: 'Python' },
  { value: 'other', label: '其他' },
];

export function ProjectRegistry() {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Record<string, ProjectConfig>>({});
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formKey, setFormKey] = useState('');
  const [formName, setFormName] = useState('');
  const [formPath, setFormPath] = useState('');
  const [formType, setFormType] = useState('');
  const [formWebCommand, setFormWebCommand] = useState('');
  const [formWebUrl, setFormWebUrl] = useState('');

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects ?? {});
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchProjects();
    }
  }, [open, fetchProjects]);

  const resetForm = () => {
    setFormKey('');
    setFormName('');
    setFormPath('');
    setFormType('');
    setFormWebCommand('');
    setFormWebUrl('');
    setShowForm(false);
  };

  const handleAdd = async () => {
    if (!formKey.trim() || !formName.trim() || !formPath.trim() || !formType) return;

    const project: ProjectConfig = {
      name: formName.trim(),
      path: formPath.trim(),
      type: formType as ProjectConfig['type'],
    };
    if (formWebCommand.trim()) project.webCommand = formWebCommand.trim();
    if (formWebUrl.trim()) project.webUrl = formWebUrl.trim();

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: formKey.trim(), ...project }),
      });
      if (res.ok) {
        resetForm();
        fetchProjects();
      }
    } catch (err) {
      console.error('Failed to add project:', err);
    }
  };

  const handleDelete = async (key: string) => {
    try {
      const res = await fetch(`/api/projects/${key}`, { method: 'DELETE' });
      if (res.ok) {
        fetchProjects();
      }
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="sm" title="项目管理">
          <Settings className="h-4 w-4" />
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">项目管理</Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Project list */}
          <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
            {loading ? (
              <p className="text-sm text-zinc-400 text-center py-4">加载中...</p>
            ) : Object.keys(projects).length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-4">暂无注册项目</p>
            ) : (
              Object.entries(projects).map(([key, config]) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-md border border-zinc-100 p-3 dark:border-zinc-800"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-3.5 w-3.5 text-zinc-400" />
                      <span className="text-sm font-medium">{config.name}</span>
                      <Badge variant="secondary" className="text-[10px]">{config.type}</Badge>
                    </div>
                    <span className="text-xs text-zinc-400 font-mono pl-5.5">{config.path}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(key)}
                    className="text-zinc-400 hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>

          {/* Add form */}
          {showForm ? (
            <div className="mt-4 flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="项目 Key" value={formKey} onChange={(e) => setFormKey(e.target.value)} />
                <Input placeholder="项目名称" value={formName} onChange={(e) => setFormName(e.target.value)} />
              </div>
              <Input placeholder="项目路径" value={formPath} onChange={(e) => setFormPath(e.target.value)} />
              <Select options={projectTypes} placeholder="项目类型" value={formType} onChange={setFormType} />
              <Input placeholder="Web 命令 (可选)" value={formWebCommand} onChange={(e) => setFormWebCommand(e.target.value)} />
              <Input placeholder="Web URL (可选)" value={formWebUrl} onChange={(e) => setFormWebUrl(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAdd} disabled={!formKey.trim() || !formName.trim() || !formPath.trim() || !formType}>
                  添加
                </Button>
                <Button size="sm" variant="ghost" onClick={resetForm}>
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="mt-4 w-full" onClick={() => setShowForm(true)}>
              <Plus className="h-3.5 w-3.5" />
              添加项目
            </Button>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
