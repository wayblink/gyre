export type RuntimeParameterEntry = {
  path: string;
  required: boolean;
  type: string;
  label: string;
};

export type RuntimeInputFileItem = {
  file: RuntimeParameterEntry;
  sheet?: RuntimeParameterEntry;
};

type RuntimeParameterPathEntry = Pick<RuntimeParameterEntry, 'path' | 'type'>;

export function isRuntimeFileParameter(entry: RuntimeParameterPathEntry): boolean {
  return entry.type === 'object' && entry.path.startsWith('fileRefs.');
}

export function isRuntimeInputFileParameter(entry: RuntimeParameterPathEntry): boolean {
  return isRuntimeFileParameter(entry) || entry.path.startsWith('sheetNames.') || /^fileRefs\.[^.]+\.sheet$/.test(entry.path);
}

export function shouldRerenderRuntimeDefaultControl(type: string): boolean {
  return type === 'fileRef';
}

export function buildRuntimeInputFileItems(entries: RuntimeParameterEntry[]): RuntimeInputFileItem[] {
  const sheetsBySourceKey = new Map(entries.flatMap((entry) => {
    if (entry.path.startsWith('sheetNames.')) {
      return [[entry.path.slice('sheetNames.'.length), entry] as const];
    }
    const nestedSheet = entry.path.match(/^fileRefs\.([^.]+)\.sheet$/);
    return nestedSheet ? [[nestedSheet[1] as string, entry] as const] : [];
  }));

  return entries
    .filter(isRuntimeFileParameter)
    .map((file) => ({
      file,
      sheet: sheetsBySourceKey.get(file.path.slice('fileRefs.'.length)),
    }));
}
