export const convertPropToKebabCase = (prop: string) => {
  if (prop !== 'ISSN' && prop !== 'ISBN' && prop !== 'DOI') {
    return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
  } else {
    return prop
  }
}
