export type WorkspaceConfig = {
  slug: string;
  name: string;
};

export const DEFAULT_WORKSPACES: WorkspaceConfig[] = [
  {
    slug: 'internal',
    name: 'Không gian chung',
  },
  {
    slug: 'hr',
    name: 'Nhân Sự (HR)',
  },
  {
    slug: 'it',
    name: 'Công Nghệ (IT)',
  },
];

export function getDefaultWorkspaceSlug(): string {
  return 'internal';
}

export function normalizeWorkspaceSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
