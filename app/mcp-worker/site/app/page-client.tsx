"use client";

import * as React from "react";
import {
  PlasmicNewPage,
  DefaultNewPageProps
} from "../components/plasmic/strona_o_mcp/PlasmicNewPage"; // plasmic-import: 5jvvpBEak3V1/render

export function ClientNewPage(props: DefaultNewPageProps) {
  return <PlasmicNewPage {...props} />;
}
