function addressed(lists: readonly (readonly string[])[], person: string): boolean {
  const wanted = person.toLowerCase();
  return lists.some((list) => list.some((address) => address.toLowerCase() === wanted));
}

export function copiedToPerson(
  to: readonly string[],
  cc: readonly string[],
  person: string,
): readonly string[] {
  return addressed([to, cc], person) ? [...cc] : [...cc, person];
}

export function attendingPerson(attendees: readonly string[], person: string): readonly string[] {
  return addressed([attendees], person) ? [...attendees] : [...attendees, person];
}
