/**
 * Human-facing labels for the enums that flow up from the callables and
 * Firestore docs. Centralised so a rename here reaches every screen at once
 * — the community page + the signed-in home + start-community all agree.
 *
 * Turn A knows two group types (`familyFriends`, `custom`) — the M-U2 stub.
 * Turn B extends the map with places-first types per WE_STAY_FIT_MASTER §2.
 */

export function groupTypeLabel(groupType: string | null | undefined): string {
  switch (groupType) {
    case 'familyFriends':
      return 'Family and friends';
    // `custom` is the stored value for "none of the offered types". A member
    // never reads that back as a category: the honest label is the plain one.
    case 'custom':
      return 'Community';
    default:
      return 'Community';
  }
}

/**
 * The type as a card's meta fact, or nothing. A `custom` community has no
 * type worth printing next to its name, so the card leaves the slot out
 * rather than filling it with a placeholder.
 */
export function groupTypeCardLabel(groupType: string | null | undefined): string | null {
  return groupType === 'custom' ? null : groupTypeLabel(groupType);
}

export function joinPolicyLabel(joinPolicy: string | null | undefined): string {
  switch (joinPolicy) {
    case 'public':
      return 'Public';
    case 'inviteOnly':
      return 'Anyone with the link';
    case 'private':
      return 'Private';
    default:
      return 'Private';
  }
}

export function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'foundingChampion':
      return 'Founding Champion';
    case 'coChampion':
      return 'Co-Champion';
    case 'member':
      return 'Member';
    default:
      return 'Member';
  }
}

/**
 * The role as a card's meta fact, or nothing. Only the founding Champion's
 * role says something a member acts on (they can start a goal); "Member" is
 * what everyone else already knows about themselves and is not printed.
 */
export function roleCardLabel(role: string | null | undefined): string | null {
  return role === 'foundingChampion' ? roleLabel(role) : null;
}

export function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'paused':
      return 'Paused';
    case 'archived':
      return 'Archived';
    default:
      return 'Active';
  }
}

export function memberCountLabel(n: number): string {
  return n === 1 ? '1 member' : `${n} members`;
}

export function challengeParticipationLabel(
  participantCount: number,
  completedCount: number
): string {
  const moving = participantCount === 1 ? '1 moving' : `${participantCount} moving`;
  const checkins = completedCount === 1 ? '1 check-in' : `${completedCount} check-ins`;
  return `${moving} · ${checkins}`;
}
