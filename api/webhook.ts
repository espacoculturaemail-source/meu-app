export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Método não permitido" });
  }

  try {
    const data = req.body;

    console.log("Webhook recebido:", data);

    if (data.type === "payment") {
      const paymentId = data.data.id;

      const response = await fetch(https://api.mercadopago.com/v1/payments/${paymentId}, {
        headers: {
          Authorization: Bearer SEU_ACCESS_TOKEN
        }
      });

      const payment = await response.json();

      console.log("Status do pagamento:", payment.status);

      if (payment.status === "approved") {
        console.log("Pagamento APROVADO");
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Erro no webhook:", error);
    return res.status(500).json({ error: "Erro interno" });
  }
}
