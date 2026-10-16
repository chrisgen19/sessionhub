import { baseConfig } from "@sessionhub/eslint-config/base";

export default [...baseConfig, { ignores: ["src/generated/**", "prisma/migrations/**"] }];
