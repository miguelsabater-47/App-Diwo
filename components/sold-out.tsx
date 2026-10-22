import Image from "next/image";
import { AccountActions } from "@/components/account-actions";

export function SoldOut() {
  return <section className="diwo-sold-out" aria-labelledby="sold-out-heading">
    <Image src="/brand/diwo-club.svg" alt="DIWO CLUB" width={112} height={60} priority />
    <div className="diwo-sold-out-copy">
      <p className="diwo-sold-out-event">DIWO X 2.0 · HALLOWEEN HOUSE PARTY</p>
      <p className="diwo-sold-out-date">31 OCTUBRE 2026</p>
      <h1 id="sold-out-heading">SOLD<br />OUT</h1>
      <h2>Entradas agotadas</h2>
      <p className="diwo-sold-out-description">Las solicitudes están cerradas.<br />Gracias por el interés en DIWO.</p>
    </div>
    <div className="diwo-sold-out-session"><AccountActions /></div>
  </section>;
}
