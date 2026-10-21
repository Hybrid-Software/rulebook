/** Who may record an approval. Whether a change's author may approve it is still open and is not checked here. */

const roleWords = role => String(role).replace(/^role:/, '').replace(/[-_]+/g, ' ');

/** A signed-in person holding the role may approve as that role. An agent or a service never can. */
export function checkApproval({ actor, role }) {
  if (actor?.kind !== 'person')
    return { ok: false, code: 'not_a_person', text: 'Only a signed-in person can approve a change. An agent or a service cannot.' };
  if (!Array.isArray(actor.roles) || !actor.roles.includes(role))
    return { ok: false, code: 'role_not_held', text: `This person does not hold the ${roleWords(role)} role, so they cannot approve as ${roleWords(role)}.` };
  return { ok: true };
}
