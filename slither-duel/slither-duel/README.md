# 🐍 Slither Duel

Un jeu de duel 1v1 inspiré de Slither.io avec rooms privées, comptes, et classement.

## 🚀 Installation rapide

### Prérequis
- **Node.js** v16+ → https://nodejs.org
- **npm** (inclus avec Node.js)

### Lancer le serveur

```bash
# 1. Installer les dépendances
npm install

# 2. Lancer le serveur
npm start
```

Le jeu est accessible sur **http://localhost:3000**

---

## 🌐 Jouer en ligne (accès depuis d'autres machines)

### Sur votre réseau local (LAN)
1. Lancez le serveur : `npm start`
2. Trouvez votre IP locale : `ipconfig` (Windows) ou `ifconfig` (Mac/Linux)
3. Vos amis se connectent sur `http://VOTRE_IP:3000`

### Sur Internet (hébergement)
Options recommandées :

#### Option A — Railway (gratuit, simple)
1. Créez un compte sur https://railway.app
2. Connectez votre repo GitHub ou glissez le dossier
3. Railway détecte automatiquement Node.js et lance `npm start`
4. Vous obtenez une URL publique comme `https://slither-duel.up.railway.app`

#### Option B — Render (gratuit)
1. Créez un compte sur https://render.com
2. New Web Service → connectez votre repo
3. Build command: `npm install`
4. Start command: `npm start`

#### Option C — VPS (Debian/Ubuntu)
```bash
# Installer Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs

# Cloner / uploader le projet, puis :
cd slither-duel
npm install

# Lancer en arrière-plan avec PM2
npm install -g pm2
pm2 start server/index.js --name slither-duel
pm2 startup  # pour démarrer au boot
```

#### Variables d'environnement (optionnel)
```
PORT=3000               # Port du serveur (défaut: 3000)
JWT_SECRET=votre_secret # Clé secrète JWT (changez en production!)
DB_PATH=./data/slither.db  # Chemin base de données
```

---

## 🎮 Comment jouer

### Contrôles
| Action | Contrôle |
|--------|----------|
| Diriger le serpent | Mouvement de la souris |
| Boost (accélération) | Maintenir Clic gauche |
| Chat | Appuyer sur `T` |
| Envoyer message | `Entrée` |

### Règles
- **Mangez la nourriture** pour grandir
- **Évitez** les bords de la carte et le corps de l'adversaire
- **Collision tête-corps** = mort instantanée
- **Collision tête-tête** : le plus long serpent survit (égalité = les deux meurent)
- En boostant, vous **perdez des segments** mais gagnez en vitesse
- Tuer l'adversaire vous donne **+20 segments bonus** et son corps devient de la nourriture

### Rooms privées
1. Cliquez **"+ New Private Room"** → un code 4 caractères est généré
2. Partagez ce code à votre ami
3. Votre ami entre le code et clique **"Join Room"**
4. La partie démarre automatiquement après un compte à rebours de 3 secondes

---

## 📁 Structure du projet

```
slither-duel/
├── server/
│   ├── index.js        # Serveur Express + WebSocket
│   ├── gameRoom.js     # Logique de jeu (physique, collisions, nourriture)
│   └── database.js     # Base de données SQLite (comptes, stats)
├── client/
│   └── public/
│       ├── index.html  # Interface (auth, lobby, jeu)
│       └── game.js     # Rendu canvas, input, WebSocket client
├── data/               # Base de données SQLite (créé automatiquement)
│   └── slither.db
├── package.json
└── README.md
```

---

## ⚙️ Physique du jeu

| Paramètre | Valeur |
|-----------|--------|
| Vitesse normale | 3.5 px/tick |
| Vitesse boost | 6.5 px/tick |
| Angle max par tick | 0.065 rad (~3.7°) |
| Taille de la map | 3000×3000 px |
| Tick rate serveur | 50 ticks/seconde |
| Rayon de la tête | 10 px |
| Nourriture simultanée | 180 pièces |

---

## 🔧 Développement

```bash
# Mode développement avec rechargement automatique
npm run dev
```

Nécessite `nodemon` (inclus dans les devDependencies).
