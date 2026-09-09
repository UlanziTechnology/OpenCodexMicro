export async function navigateAndFocus(navigate, focus) {
  const [navigation, activation] = await Promise.allSettled([navigate(), focus()]);
  if (navigation.status === "rejected") throw navigation.reason;
  if (activation.status === "rejected") throw activation.reason;
  return {
    focusOk: true,
    attentionRequested: false
  };
}
