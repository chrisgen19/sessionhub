import { expect, test } from "@playwright/test";

test("the landing page leads with getting the extension, shows the product as one image, and links its privacy policy once", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Save your windows.Find them again.Reopen them later.");
  await expect(page.getByRole("link", { name: "Get the extension" })).toHaveAttribute("href", "https://github.com/chrisgen19/sessionhub#development");
  await expect(page.getByRole("main").getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/signup");
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");

  // The preview is a picture: one image to assistive technology, nothing in it to tab to or click.
  const preview = page.getByRole("img", { name: /Saved sessions/ });
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((element) => element.querySelectorAll("a, button, input, [tabindex]").length)).toBe(0);
  // Chrome's own accessibility tree, not Playwright's role query (which ignores `inert`, PR #49 review):
  // the image and its description must be there, not hidden with an inert subtree.
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: { ignored: boolean; role?: { value: string }; name?: { value: string } }[] };
  expect(nodes.some((node) => !node.ignored && ["image", "img"].includes(node.role?.value ?? "") && node.name?.value.includes("Saved sessions"))).toBe(true);
  // Still nothing in it can be focused or clicked: its content is inert, the image itself isn't.
  await expect(preview.locator("[inert]")).toHaveCount(1);

  await expect(page.getByRole("list").filter({ hasText: "No end-to-end encryption." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy policy" })).toHaveCount(1);
});

test("sign-in and sign-up say what an account is for beside the form, and after it on a phone", async ({ page }) => {
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    const panel = page.getByRole("complementary", { name: "About accounts" });
    await expect(panel.getByRole("heading", { name: "What an account is for" })).toBeVisible();
    await expect(panel).toContainText("Recovery checkpoints never upload.");
    // The form stays in the main landmark (form errors are found there).
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
  }

  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto("/signup");
  const form = await page.getByRole("main").boundingBox();
  const panel = await page.getByRole("complementary", { name: "About accounts" }).boundingBox();
  expect(panel!.y).toBeGreaterThan(form!.y + form!.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
