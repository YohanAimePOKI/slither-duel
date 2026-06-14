# 🐍 Slither Duel

Jeu de duel 1v1 style Slither.io — jouable en ligne 24h/24.

## Fonctionnalités

- Connexion / Inscription / Invité
- Matchmaking automatique 1v1
- Rooms privées avec code à 4 caractères
- Serpent avec boost, nourriture, map ronde
- Victoire par collision : tête dans le corps adverse (si tête vs tête, le plus gros gagne)

---

## Mise en ligne sur Render (gratuit, 24h/24)

### 1. Mettre le projet sur GitHub

```bash
# Dans le dossier slither-duel/ dézippé :
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/TON-USERNAME/slither-duel.git
git push -u origin main
```

### 2. Créer le service sur Render

1. Va sur [render.com](https://render.com) et connecte ton compte GitHub
2. Clique **New → Web Service**
3. Sélectionne ton repo `slither-duel`
4. Render détecte automatiquement `render.yaml` — clique **Create Web Service**
5. Attends ~2 minutes que le build se termine
6. Ton jeu est en ligne à `https://slither-duel.onrender.com` (ou similaire)

### 3. Garder le service actif 24h/24 (plan gratuit)

Le plan gratuit de Render met en veille le service après 15 minutes d'inactivité.
Pour le garder éveillé :

- Va sur [uptimerobot.com](https://uptimerobot.com) (gratuit)
- Crée un monitor **HTTP** sur `https://ton-url.onrender.com/health`
- Intervalle : **5 minutes**
- Le service restera actif en permanence ✅

> Pour un vrai 24h/24 garanti sans UptimeRobot → passe sur le plan **Render Starter** ($7/mois).

---

## Lancer en local

```bash
npm install
npm start
# → http://localhost:3000
```

---

## Stack technique

| Couche    | Technologie                        |
|-----------|------------------------------------|
| Serveur   | Node.js · Express · ws (WebSocket) |
| Auth      | JWT · bcryptjs                     |
| Données   | In-memory Map (pas de base de données) |
| Frontend  | HTML · CSS · Canvas 2D (vanilla JS) |
| Hébergement | Render                           |

---

## Contrôles

| Action | PC | Mobile |
|--------|----|--------|
| Direction | Souris | Glisser le doigt |
| Boost | Clic gauche maintenu · Espace | Toucher l'écran |
