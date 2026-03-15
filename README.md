# Clickmania

Clicker game with accounts, friends, and competitive click races.

## Run the app

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open **http://localhost:3000** in your browser.

## Features

- **Sign up / Sign in** – Create an account or sign in when you first load the site (username + password).
- **Users** – Search for any user by username and add them as a friend.
- **Races** – Challenge a friend to a click race:
  - Host creates a race and picks **target clicks** and **stake** (coins).
  - Opponent accepts the invite.
  - Both start at 0 clicks; first to reach the target wins.
  - Winner receives the stake from the loser.

Data (users, friends, races) is stored in `data.json` in the project folder.
