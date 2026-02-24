export const memoryStore = {
  nextId: 1,
  users: [],
  messages: [],
  guestUsages: [],
  resetTokens: [],
  payments: [],
};

export const createMemoryUserId = () => `mem_${memoryStore.nextId++}`;
export const createMemoryMessageId = () => `msg_${memoryStore.nextId++}`;
export const createMemoryGuestUsageId = () => `guest_${memoryStore.nextId++}`;
export const createMemoryResetId = () => `rst_${memoryStore.nextId++}`;
export const createMemoryPaymentId = () => `pay_${memoryStore.nextId++}`;
