export function evaluateState(state) {
  const orders = Object.values(state.orders);
  const handoffs = Object.values(state.handoffs);
  const assertions = [
    { name: "Inventory never becomes negative", pass: state.products.every((p) => p.stock >= 0) },
    { name: "Every order references an existing handoff", pass: orders.every((o) => Boolean(state.handoffs[o.handoffToken])) },
    { name: "Every consumed handoff references one order", pass: handoffs.filter((h) => h.consumedAt).every((h) => Boolean(h.orderId && state.orders[h.orderId])) },
    { name: "No handoff creates multiple orders", pass: new Set(orders.map((o) => o.handoffToken)).size === orders.length },
    { name: "All prices come from the catalog", pass: orders.every((o) => state.products.some((p) => p.productId === o.productId && p.variant === o.variant && p.price === o.unitPrice)) },
    { name: "Every order has a real source comment", pass: orders.every((o) => Boolean(state.comments[o.sourceCommentId])) }
  ];
  return { pass: assertions.every((a) => a.pass), passed: assertions.filter((a) => a.pass).length, total: assertions.length, assertions };
}
