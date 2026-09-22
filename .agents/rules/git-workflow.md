# Automatic Commit and Push Rule

Always automatically stage, commit, and push changes to the remote git repository after completing any requested modifications or fixes:
1. Ensure all relevant files are staged (`git add`).
2. Write a concise, descriptive commit message explaining the changes.
3. Automatically run `git push origin main` (or the active working branch).
4. Verify the push succeeded and the working tree is clean.
