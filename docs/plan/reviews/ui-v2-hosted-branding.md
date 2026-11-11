# UI v2 hosted branding independent review

Date: 2026-11-11. Result: **pass** for the narrow shared Logto branding/color patch. No blocking findings.

## Scope and evidence

This review independently reads the deployed management configuration and opens the real hosted OAuth login page in isolated Chrome contexts. It does not authenticate a user, submit credentials, modify configuration, or establish a business connection. The reviewed operation is the separately recorded exception for a narrow visual patch to shared `/api/sign-in-exp`; it does not change the existing provisioning tool's shared-configuration preservation contract.

- The private `~/.config/anywork-cloud/ui-v2-branding-20261111/{before,payload,readback,intent}.json` files have private permissions. Intent is `observed` with `nonvisualFieldsUnchanged: true`.
- Payload contains exactly `branding` and `color`. Branding's `logoUrl`, `darkLogoUrl`, `favicon`, and `darkFavicon` all point to `https://anywork-tau.vercel.app/app/icon.svg`. Color is exactly `primaryColor: #171717`, `darkPrimaryColor: #FFFFFF`, `isDarkModeEnabled: false`.
- A fresh authenticated management GET equals the stored readback in full. Excluding `branding` and `color`, all 35 remaining top-level fields and their nested values equal `before`. Login/registration methods, terms, policies, language, connectors and all other configuration are preserved.
- The deployed API schema permits this partial PATCH and supports all submitted branding fields. Application-level customization is third-party-only; the current AnyWork SPA and Native applications remain non-third-party. No application conversion is part of this patch.
- The public icon returns anonymous HTTPS 200 without redirect, with `image/svg+xml`. Its 2736 bytes exactly match `web/public/icon.svg`; SHA-256 is `2e697e060d2129a9f5126fe9f280daf6d11b05ab91a1aa680a47dc182c2ebdbd`. Hosted-page CSP allows HTTPS images.

## Actual browser checks

Fresh contexts used the existing public SPA client and approved production callback with an OAuth authorization-code/PKCE login request. No identifier or password was filled and no login button was pressed. Both contexts reached the real `https://auth.x.aixgg.com/sign-in` page.

| Viewport | Observed result | Screenshot |
| --- | --- | --- |
| 1440 × 960 | Canonical logo decoded and displayed; login button computed background `rgb(23, 23, 23)` and text `rgb(255, 255, 255)`; no horizontal overflow | [Hosted desktop](ui-v2-hosted-branding-1440.png) |
| 390 × 844 | Same loaded canonical logo and button colors; usable single-column form; no horizontal overflow | [Hosted narrow](ui-v2-hosted-branding-390.png) |

Both screenshots were visually inspected. They are captures of the actual hosted service, without a prototype wrapper. The reviewer's management helper obtained a management token in memory without saving private state; configuration operations were GET only.

## Limits

This is acceptance of branding resources and primary colors, not a full custom hosted layout or authentication regression test. Logto's existing pale violet page background, form spacing and `Powered by Logto` footer remain visible; no custom CSS, footer-hiding setting or additional configuration was added. Dark mode remains disabled; dark branding URLs are verified in configuration, rather than by enabling another mode. The shared setting applies to the tenant's hosted experience, including any future interactive applications that inherit it.
