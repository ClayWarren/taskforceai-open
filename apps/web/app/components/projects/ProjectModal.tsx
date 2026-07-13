'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useProjects } from '../../lib/projects/ProjectsContext';
import { Button } from '@taskforceai/ui-kit/button';
import { Input } from '@taskforceai/ui-kit/input';
import { Textarea } from '@taskforceai/ui-kit/textarea';

const ProjectModal: React.FC = () => {
  const { isModalOpen, setModalOpen, createProject } = useProjects();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    const success = await createProject(name, description, instructions);
    setIsSubmitting(false);

    if (success) {
      setName('');
      setDescription('');
      setInstructions('');
      setModalOpen(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    void handleSubmit(e);
  };

  const modalContent = (
    <>
      <div className="profile-modal-overlay" onClick={() => setModalOpen(false)} />
      <div className="profile-modal !max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => setModalOpen(false)}
          className="profile-modal__close"
          aria-label="Close"
        >
          ×
        </button>

        <div className="profile-modal__header">
          <h2>Create new project</h2>
          <p>Projects keep chats, files, and custom instructions in one place.</p>
        </div>

        <form onSubmit={handleFormSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Q1 Marketing Plan"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description (optional)</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-col gap-0.5">
              <label className="text-sm font-medium">Custom instructions</label>
              <p className="text-xs text-muted-foreground">
                What would you like the AI to know about this project?
              </p>
            </div>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Instructions for the AI within this project..."
              className="min-h-[120px] resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !name.trim()}>
              {isSubmitting ? 'Creating...' : 'Create project'}
            </Button>
          </div>
        </form>
      </div>
    </>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
};

export default ProjectModal;
