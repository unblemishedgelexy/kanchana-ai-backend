export const memoryStore = {
  nextId: 1,
  users: [],
  messages: [],
  resetTokens: [],
  payments: [],
};

export const createMemoryUserId = () => `mem_${memoryStore.nextId++}`;
export const createMemoryMessageId = () => `msg_${memoryStore.nextId++}`;
export const createMemoryResetId = () => `rst_${memoryStore.nextId++}`;
export const createMemoryPaymentId = () => `pay_${memoryStore.nextId++}`;
