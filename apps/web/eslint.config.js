import { reactConfig } from "@sessionhub/eslint-config/react";

export default [...reactConfig, { ignores: [".next/**", "next-env.d.ts"] }];
