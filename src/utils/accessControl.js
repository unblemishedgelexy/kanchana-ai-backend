export const normalizeRole = (user) => {
  if (user?.isHost === true) {
    return "host";
  }

  const role = String(user?.role || "normal").trim().toLowerCase();
  return role === "host" ? "host" : "normal";
};

export const isHostUser = (user) => normalizeRole(user) === "host";

export const isPremiumUser = (user) => String(user?.tier || "Free") === "Premium";

export const hasPremiumAccess = (user) => isPremiumUser(user) || isHostUser(user);
