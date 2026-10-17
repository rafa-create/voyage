import { defineConfig } from "astro/config";

const githubPages = process.env.GITHUB_PAGES === "true";

export default defineConfig({
  site: githubPages ? "https://rafa-create.github.io" : undefined,
  base: githubPages ? "/voyage/" : "/",
});
