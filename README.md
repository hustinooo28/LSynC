# Digital Transparency Board

A web-based **Digital Transparency Board** designed to provide a centralized platform for managing, publishing, and viewing transparent organizational information.

Built with **React, TypeScript, Vite, Tailwind CSS, and Supabase**.

---

## 📋 Table of Contents

* [About the Project](#-about-the-project)
* [Technology Stack](#-technology-stack)
* [Features](#-features)
* [Project Structure](#-project-structure)
* [Getting Started](#-getting-started)
* [Environment Variables](#-environment-variables)
* [Available Scripts](#-available-scripts)
* [Git & Environment File Safety](#-git--environment-file-safety)
* [Development Workflow](#-development-workflow)
* [Contributing](#-contributing)

---

## 📌 About the Project

The **Digital Transparency Board** is a web application intended to provide an accessible and centralized system for managing and presenting organizational information.

The system uses a modern frontend architecture with Supabase serving as the backend and database platform.

---

## 🛠 Technology Stack

### Frontend

* **React** – User interface framework
* **TypeScript** – Type-safe JavaScript
* **Vite** – Development server and build tool
* **Tailwind CSS** – Utility-first CSS framework
* **Radix UI** – Accessible UI components
* **Lucide React** – Icon library

### Backend & Database

* **Supabase**

  * PostgreSQL database
  * Authentication
  * Backend services
  * API

### Additional Libraries

* Recharts
* GSAP
* QRCode
* jsQR
* read-excel-file

---

## ✨ Features

The project includes functionality for:

* 📊 Digital information and transparency management
* 🔐 User authentication and authorization
* 🗄️ Supabase database integration
* 📱 Responsive web interface
* 📈 Data visualization and charts
* 📷 QR code generation and scanning
* 📑 Excel data processing
* 🎨 Modern component-based UI
* ⚡ Fast development and production builds through Vite

> Features may change as development continues.

---

## 📁 Project Structure

```text
src/
├── App.tsx              # View routing + auth/session wiring
├── index.css            # Design system (tokens, cards, buttons, inputs, chips)
├── sections/            # One file per page (public + staff)
├── components/
│   ├── ui/              # Shared primitives — see components/ui/README.md
│   └── *.tsx            # Domain components (QR, receipts, notifications…)
├── hooks/               # useSearch, usePagination, useTheme, useSpreadsheetImport
├── services/            # Supabase data access (db, auth, notifications)
├── lib/                 # Pure helpers (format, roles, receipts, qr, offline sync…)
└── types/               # Shared domain types
supabase/                # SQL schema, migrations, edge function (send-push)
scripts/                 # Admin maintenance scripts (service-role key)
public/                  # Static assets + service worker (sw.js)
```

UI conventions (tokens, classes, components) are documented in
[`src/components/ui/README.md`](src/components/ui/README.md).

---

# 🚀 Getting Started

## Prerequisites

Make sure the following are installed:

* [Node.js](https://nodejs.org/)
* npm
* Git

Check your installations:

```bash
node --version
npm --version
git --version
```

---

## 1. Clone the Repository

```bash
git clone https://github.com/Nano-saku/Digital-Transparence-Board.git
```

Enter the project directory:

```bash
cd Digital-Transparence-Board
```

---

## 2. Install Dependencies

Install the project's dependencies using:

```bash
npm install
```

For a clean installation based on the lock file:

```bash
npm ci
```

Do **not** manually install the packages listed in `package.json`. Running `npm install` or `npm ci` installs the required dependencies automatically.

---

# 🔐 Environment Variables

The application uses environment variables for configuration and Supabase access.

Create a local `.env` file based on the provided example:

### Windows PowerShell

```powershell
Copy-Item .env.example .env
```

### macOS / Linux

```bash
cp .env.example .env
```

Then open `.env` and configure the required values.

Example:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### ⚠️ Important

**Never commit `.env` to Git.**

The repository's `.gitignore` is configured to ignore environment files:

```gitignore
.env
.env.*
!.env.example
```

The `.env.example` file may be committed because it should contain **placeholders only**, never real credentials.

### Service Role Key

The Supabase service-role key is highly privileged and must be kept secret.

**Never:**

* Commit it to Git
* Share it publicly
* Put it in frontend/client-side code
* Prefix it with `VITE_`

If a secret is accidentally committed or exposed, **rotate/revoke the affected credential immediately**.

---

# ▶️ Running the Development Server

Start the development server:

```bash
npm run dev
```

Vite will display the local development URL in the terminal, typically:

```text
http://localhost:5173
```

Open the displayed URL in your browser.

---

# 📦 Building for Production

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

---

# 🔍 Linting

Run ESLint:

```bash
npm run lint
```

---

# 🌿 Git & Environment File Safety

## Never commit `.env`

Before committing changes, check:

```bash
git status
```

You can verify whether `.env` is being tracked with:

```bash
git ls-files .env
```

If the command returns nothing, `.env` is not currently tracked.

If `.env` has already been tracked, remove it from Git tracking **without deleting your local file**:

```bash
git rm --cached .env
```

Then commit the change:

```bash
git add .gitignore
git commit -m "Stop tracking environment configuration"
```

---

## Before Every Push

Recommended workflow:

```bash
git status
git add .
git commit -m "Describe your changes"
git push
```

Before pushing, make sure:

* `.env` is not listed as a staged file
* No API keys or passwords are present in the changes
* `.env.example` contains placeholders instead of real credentials

---

# 🔄 Development Workflow

When starting work:

```bash
git pull
```

Create a feature branch when appropriate:

```bash
git checkout -b feature/your-feature-name
```

After making changes:

```bash
git status
git add .
git commit -m "Add your change description"
git push -u origin feature/your-feature-name
```

For small team changes directly on `master`:

```bash
git pull
git add .
git commit -m "Describe your changes"
git push
```

Avoid force-pushing shared branches unless the team has explicitly agreed to rewrite the history.

---

# 🤝 Contributing

When contributing to the project:

1. Pull the latest changes before starting work.
2. Create a branch for significant features or fixes.
3. Keep commits focused and descriptive.
4. Do not commit credentials, API keys, passwords, or `.env` files.
5. Test your changes locally before pushing.
6. Keep the README and relevant documentation updated.

---

## 📄 License

Add the project's applicable license here.

---

## 👥 Development Team

**Digital Transparency Board**

Repository:
https://github.com/Nano-saku/Digital-Transparence-Board
