import type { NextPage } from "next";
import Head from "next/head";

const Home: NextPage = () => (
  <>
    <Head>
      <title>Żar i Szlif</title>
      <meta name="description" content="Strona Żar i Szlif." />
    </Head>
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <div>
        <h1>Żar i Szlif</h1>
        <p>Projekt strony WWW przygotowany do integracji z Plasmic.</p>
      </div>
    </main>
  </>
);

export default Home;
