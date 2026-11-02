# Jinglee

Lecteur de jingles et de conduites sonores pour le **théâtre** et le **podcast**.
Libre, gratuit, sans compte, et conçu pour les tablettes, y compris les anciennes (iPad mini 4 sous iPadOS 15, vieux Android).

Jinglee est une application web installable (PWA) : on l'ouvre une fois dans le navigateur, on l'ajoute à l'écran d'accueil, et elle fonctionne ensuite **hors-ligne**. Les sons restent sur la tablette.

## Fonctionnalités

- **Pads** : grille de jingles en couleur, organisée en onglets, déclenchés d'un simple toucher.
  Un second toucher arrête le son en fondu (3 s par défaut), ou au choix l'arrête net, le relance, le met en pause ou superpose une lecture.
- **Conduite** avec un grand bouton **GO** : cue en attente surlignée, notes de régie, enchaînements automatiques
  (« avec la précédente » ou « à la fin de la précédente », avec délai), actions « fondu général » et « arrêt général ».
- **Lignes de texte** dans la conduite (réplique, mouvement, repère) : GO les saute, et le texte qui annonce la cue en attente est surligné.
- **Mode de transition** dans la barre du haut : superposer les sons, fondu enchaîné (durée réglable) ou couper le précédent.
- **Bandeau « En cours »** : tous les sons qui jouent, avec temps restant, pause, fondu et arrêt individuels.
- **Réglages par son** : volume, points de début et de fin sur une frise avec la forme d'onde, fondu d'entrée et de sortie, boucle, **ducking**
  (baisse automatique des autres sons), arrêt des autres sons au départ d'une cue.
- **Boutons de sécurité** : FONDU (durée réglable) et STOP général, **verrouillage** du mode spectacle.
- Trois vues : **Conduite**, **Mixte** (conduite + pads) et **Pads**, en paysage comme en portrait.
- **Projets** multiples, export et import dans un fichier `.jinglee` (un ZIP standard contenant `project.json` et les sons).
- Chronomètre de spectacle et horloge.
- Clavier ou pédale Bluetooth : `Espace` / `Page suivante` = GO, flèches = cue en attente, `Échap` = fondu, `Maj+Échap` = stop.

## Installation sur une tablette

Jinglee doit être servi en **HTTPS** pour fonctionner hors-ligne. Le plus simple est GitHub Pages :

1. Publiez ce dossier dans un dépôt GitHub, puis activez *Settings → Pages* sur la branche principale.
2. Sur l'iPad, ouvrez l'adresse dans **Safari**, touchez *Partager* → *Sur l'écran d'accueil*
   (un bandeau le rappelle tant que Jinglee n'est pas installé).
3. Lancez Jinglee depuis l'icône (et non depuis Safari) : c'est cette version installée qui garde vos sons.
4. Sur Android, ouvrez l'adresse dans Chrome et choisissez *Installer l'application*.

> Sur iOS, l'application installée et Safari ont des données séparées : importez vos sons depuis l'application installée.

### Conseils pour le spectacle

- Réglez le **verrouillage automatique** de la tablette sur **Jamais** : le son s'arrête si l'écran se verrouille.
  Jinglee essaie déjà d'empêcher la mise en veille, mais ce réglage reste la meilleure garantie.
- Activez le mode avion ou « Ne pas déranger » pour éviter les notifications sonores.
- **Exportez** votre projet après chaque modification importante : c'est votre sauvegarde.
- Import depuis Google Drive ou un autre service : si vos MP3 apparaissent grisés dans le sélecteur,
  cochez *Menu → Réglages → Montrer tous les fichiers à l'import*. Jinglee vérifie alors lui-même chaque fichier.
  Pour les projets `.jinglee`, le sélecteur de l'iPad montre toujours tous les fichiers (iOS ne connaît pas cette extension).
- Préférez des fichiers MP3/AAC/M4A pour les longues pistes. Tous les sons sont décodés en mémoire pour un
  départ instantané ; sur un iPad mini 4 (2 Go de RAM), Jinglee garde environ 350 Mo de sons décodés
  (≈ 30 minutes de stéréo) et recharge les autres à la demande.

## Développement

Aucune dépendance ni étape de compilation : HTML, CSS et JavaScript (modules ES) compatibles Safari 15.

```bash
python -m http.server 8642
```

Puis ouvrez http://localhost:8642.

Le service worker (cache hors-ligne) n'est activé qu'en HTTPS, donc pas en local. À chaque version publiée,
changez la constante `CACHE` dans `sw.js` : c'est ce qui déclenche la mise à jour sur les tablettes déjà installées.

| Fichier | Rôle |
|---|---|
| `js/audio.js` | Moteur Web Audio : décodage, cache, voix, fondus, ducking |
| `js/show.js` | Logique de spectacle : pads, GO, enchaînements |
| `js/main.js` | État de l'application, écran principal, menus |
| `js/editor.js` | Fenêtre de réglage d'un pad ou d'une cue |
| `js/model.js` | Modèle de données d'un projet |
| `js/db.js` | Stockage IndexedDB |
| `js/archive.js`, `js/zip.js` | Export / import `.jinglee` |
| `js/device.js` | Anti-veille, session audio iOS |
| `tools/make_assets.py` | Génère les icônes et `js/media.js` |

Pour régénérer les médias embarqués (nécessite ffmpeg et Pillow) :

```bash
ffmpeg -f lavfi -i color=c=black:s=16x16:r=1 -t 2 -c:v libx264 -profile:v baseline -pix_fmt yuv420p -an assets/keepawake.mp4
ffmpeg -f lavfi -i anullsrc=r=22050:cl=mono -t 1 -c:a libmp3lame -b:a 32k assets/silence.mp3
python tools/make_assets.py
```

## Pistes pour la suite

- Forme d'onde dans l'éditeur pour placer les points de début et de fin au doigt
- Cue « niveau » (baisser un son en cours sans l'arrêter)
- Playlist d'entracte (aléatoire, boucle)
- Télécommande depuis un téléphone, MIDI / OSC
- Pré-écoute sur une sortie séparée

## Licence

MIT — voir [LICENSE](LICENSE).
