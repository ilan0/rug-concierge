"use client";

import { FormEvent, useState } from "react";

export default function PasscodePage() {
  const [passcode, setPasscode] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const response = await fetch("/api/auth/passcode", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ passcode }),
    });

    if (response.ok) {
      window.location.href = "/concierge";
    }
  }

  return (
    <main style={{ padding: "2rem", maxWidth: "28rem", margin: "0 auto" }}>
      <h1>Enter Passcode</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="passcode">Passcode</label>
        <input
          id="passcode"
          name="passcode"
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          required
        />
        <button type="submit">Unlock</button>
      </form>
    </main>
  );
}
