function parseBool(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

export const wsfAuthEnabled: boolean = parseBool(process.env.EXPO_PUBLIC_WSF_AUTH_ENABLED);
