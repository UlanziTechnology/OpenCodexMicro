export async function navigateAndFocus(navigate, focus) {
  const [navigation, activation] = await Promise.allSettled([navigate(), focus()]);
  if (navigation.status === "rejected") throw navigation.reason;
  return { focusOk: activation.status === "fulfilled" };
}
