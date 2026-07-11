import type * as SQLite from 'expo-sqlite';

import { mobileLogger } from '../logger';

type PromptQueueRow = {
    conversation_id?: string;
    prompt?: string;
    status?: string;
    created_at?: number;
    model_id?: string | null;
    attachment_ids?: string | null;
};

type PendingPromptChangeRow = {
    entity_id?: string;
    created_at?: number;
    data?: string | null;
};

const normalizePromptStatus = (value: unknown): 'queued' | 'pending' | 'failed' => {
    return value === 'pending' || value === 'failed' || value === 'queued' ? value : 'queued';
};

const readAttachmentIds = (value: string | null | undefined): string[] | undefined => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) {
            return undefined;
        }
        const attachmentIds = parsed.flatMap((entry) => {
            if (typeof entry !== 'string') {
                return [];
            }
            const trimmed = entry.trim();
            return trimmed.length > 0 ? [trimmed] : [];
        });
        return attachmentIds.length > 0 ? attachmentIds : undefined;
    } catch {
        return undefined;
    }
};

const readPromptSignature = (row: PendingPromptChangeRow): string | null => {
    if (typeof row.entity_id !== 'string' || row.entity_id.length === 0) {
        return null;
    }
    if (typeof row.created_at !== 'number') {
        return null;
    }
    if (typeof row.data !== 'string' || row.data.length === 0) {
        return null;
    }

    try {
        const parsed = JSON.parse(row.data) as { prompt?: unknown };
        if (typeof parsed.prompt !== 'string' || parsed.prompt.length === 0) {
            return null;
        }
        return `${row.entity_id}\u0000${parsed.prompt}\u0000${row.created_at}`;
    } catch {
        return null;
    }
};

export const backfillLegacyPromptQueue = (rawDb: SQLite.SQLiteDatabase): void => {
    const tableNames = new Set(
        rawDb.getAllSync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name)
    );
    if (!tableNames.has('prompt_queue') || !tableNames.has('pending_changes')) {
        return;
    }

    const legacyRows = rawDb.getAllSync<PromptQueueRow>(
        'SELECT conversation_id, prompt, status, created_at, model_id, attachment_ids FROM prompt_queue ORDER BY created_at ASC'
    );
    if (legacyRows.length === 0) {
        return;
    }

    const existingPromptChanges = rawDb.getAllSync<PendingPromptChangeRow>(
        "SELECT entity_id, created_at, data FROM pending_changes WHERE type = 'prompt'"
    );
    const knownSignatures = new Set(
        existingPromptChanges
            .map(readPromptSignature)
            .filter((signature): signature is string => typeof signature === 'string')
    );

    let insertedCount = 0;
    for (const row of legacyRows) {
        if (typeof row.conversation_id !== 'string' || row.conversation_id.length === 0) {
            continue;
        }
        if (typeof row.prompt !== 'string' || row.prompt.trim().length === 0) {
            continue;
        }
        if (typeof row.created_at !== 'number') {
            continue;
        }

        const signature = `${row.conversation_id}\u0000${row.prompt}\u0000${row.created_at}`;
        if (knownSignatures.has(signature)) {
            continue;
        }

        const attachmentIds = readAttachmentIds(row.attachment_ids);
        const runPayload: Record<string, unknown> = {
            prompt: row.prompt,
            demo: false,
            ...(typeof row.model_id === 'string' && row.model_id.length > 0 ? { modelId: row.model_id } : {}),
            ...(attachmentIds ? { attachment_ids: attachmentIds } : {}),
        };
        const data = JSON.stringify({
            prompt: row.prompt,
            status: normalizePromptStatus(row.status),
            runPayload,
        });

        rawDb.runSync(
            'INSERT INTO pending_changes (type, entity_id, operation, data, created_at) VALUES (?, ?, ?, ?, ?)',
            ['prompt', row.conversation_id, 'create', data, row.created_at]
        );
        knownSignatures.add(signature);
        insertedCount += 1;
    }

    if (insertedCount > 0) {
        mobileLogger.info('[MigrationRunner] Backfilled legacy prompt_queue rows into pending_changes', {
            insertedCount,
        });
    }
};
