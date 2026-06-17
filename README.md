# Nulqor Launch Site

Static pre-launch website for Nulqor and Forge Studio.

## Files

- `index.html` - page structure, copy, pricing tiers, early access form, backend hook comments
- `policies.html` - policy bundle page with Terms, Privacy, Refunds, Acceptable Use, Early Access, Downloads, Support, AI, liability, and contact sections
- `styles.css` - visual system, responsive layout, cards, hero, pricing toggle styling
- `script.js` - particle field, pricing display toggle, frontend-only waitlist form behavior
- `assets/nulqor-icon.png` - small nav/footer logo icon from the supplied screenshot
- `assets/nulqor-core.png` - generated hero visual placeholder

## Replace Later

- Replace `assets/nulqor-icon.png` with the final compact Nulqor mark.
- Replace `assets/nulqor-core.png` with official Forge Studio/Nulqor product imagery.
- Connect the comments in `index.html` and `script.js` to login, Stripe billing, protected downloads, license/session protection, cloud saves, marketplace, team dashboard, and waitlist/email capture.

## Preview

The current local preview is running at:

```text
http://127.0.0.1:4173/
```

## Public Launch Checklist

1. Buy a domain, ideally `nulqor.com` if available, or another official Nulqor domain.
2. Put this folder in a GitHub repository so a host can deploy it.
3. Deploy the static site with a host such as Vercel, Netlify, Cloudflare Pages, or GitHub Pages.
4. Point the domain DNS records to the host and enable HTTPS/SSL.
5. Replace the frontend-only waitlist form with a real backend endpoint.
6. Send waitlist/contact messages to `teamnulqor@gmail.com`.
7. Add real analytics, error monitoring, and spam protection before launch traffic.
8. Connect payments, accounts, protected downloads, licenses, and cloud features when Forge Studio is ready.
