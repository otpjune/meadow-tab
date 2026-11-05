🌿 Meadow Tab
A calm, customisable new tab page for Chrome: a big clock, a frosted-glass search bar, a focus timer that rings even when you're in another app, and iOS-style app shortcuts. Move and resize everything wherever you like.

Installation
Meadow Tab is installed manually (no Chrome Web Store needed). It takes about a minute.
Download this project: click the green Code button → Download ZIP, then unzip it.
Open Chrome and go to `chrome://extensions`.
Turn on Developer mode (switch at the top right).
Click Load unpacked and choose the `meadow-extension` folder (the one that contains `manifest.json`).
Open a new tab. 🎉
If you see a thin bar at the bottom of the new tab (it says Customize Chrome and shows the extension name), that's Chrome's own footer for extension-provided new tab pages (Chrome 138 and newer). Extensions can't remove it, but you can hide it yourself:
Right-click the bar → Hide footer on New Tab page, or
click Customize Chrome and turn off Show footer on New tab page.
Keep the unzipped folders where they are. If you delete or move them, the extension stops working.
> Built for Chrome. Other Chromium browsers such as Edge and Brave should work too (use their own `edge://extensions` or `brave://extensions` page).
Uninstall: `chrome://extensions` → Remove on the Meadow Tab card. To remove the theme: Chrome Settings → Appearance → Reset to default.
---
Features
Clock: 12-hour real-time clock with the date.
Search: frosted-glass bar with live Google suggestions and your recent searches. Type a website address and it opens directly.
Focus timer: default 25 minutes, adjustable. Plays a sound and shows a notification when time is up, even if you're on another tab or in another app.
Shortcuts: macOS-style app icons, coloured automatically from each site's own icon. Add, edit, remove and rearrange them. The glass panel grows as you add more.
Edit layout: move and resize the clock, timer, search bar and shortcuts anywhere on screen, with Canva-style alignment guides that snap to the centre and to each other.
Lightweight: no libraries or frameworks, nothing running in the background except while a timer is active.
---
Privacy
Everything you set up (shortcuts, recent searches, layout, timer, background) is stored only in your browser. Nothing is sent to any server of ours, and there is no tracking or analytics.
Search suggestions: while you type in the search bar, the text is sent to Google's suggestion service so it can suggest completions (the same way Chrome's own address bar works).
Meadow Tab never reads, stores or asks for passwords. Shortcuts are just links.
Permissions used: `storage` (save your settings), `alarms` + `notifications` + `offscreen` (timer sound and notification), `favicon` (show site icons), `search` (use your default search engine).
---
Troubleshooting
Problem	What to do
A bar with Customize Chrome shows at the bottom	That's Chrome's footer. See step 7 of the installation to hide it.
Chrome says "Disable developer mode extensions" on startup	Normal for manually installed extensions. Dismiss the message (don't click Disable).
An icon shows a globe or blank picture	Chrome only has icons for sites it has seen. Visit the site once, then reload the new tab.
No timer sound	Check your computer isn't muted. On Windows, Focus Assist / Do Not Disturb may hide the notification, but the sound should still play.
Search suggestions don't appear	Check your internet connection.
Layout got messy	⋯ → Edit layout → Reset layout.
---
License
MIT. You're free to use, copy, modify and share Meadow Tab, as long as the copyright notice and licence are kept. The built-in wallpapers are shared under the same terms.
