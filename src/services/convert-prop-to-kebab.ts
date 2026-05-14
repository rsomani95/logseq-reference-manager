// Converts a camelCase property name to its kebab-case identifier used as the
// Logseq property key. Consecutive uppercase runs (e.g. 'archiveID') are kept
// together so they kebab to 'archive-id', not 'archive-i-d'.
export const convertPropToKebabCase = (prop: string) => {
  if (prop === 'DOI' || prop === 'ISSN' || prop === 'ISBN') return prop
  return prop
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}
