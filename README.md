# Jinglee

Lecteur de jingles et de conduites sonores pour le **théâtre** et le **podcast**.
Libre, gratuit, sans compte, et conçu pour les tablettes, y compris les anciennes (iPad mini 4 sous iPadOS 15, vieux Android).

Jinglee est une application web installable (PWA) : on l'ouvre une fois dans le navigateur, on l'ajoute à l'écran d'accueil, et elle fonctionne ensuite **hors-ligne**. Les sons restent sur la tablette.

**👉 Utiliser Jinglee : https://mathgen44.github.io/jinglee/**

![Écran principal : conduite à gauche, pads à droite, sons en cours en haut](docs/ecran-principal.png)

## Fonctionnalités

### En spectacle

- **Pads** : grille de jingles en couleur, organisée en onglets, déclenchés d'un simple toucher.
  Un second toucher arrête le son **en fondu** (par défaut), ou au choix l'arrête net, le relance, le met en pause ou lance une lecture de plus.
- **Conduite** avec un grand bouton **GO** : la cue en attente est surlignée, avec ses notes de régie.
  Enchaînements automatiques « avec la précédente » ou « à la fin de la précédente », avec délai.
  Actions « fondu général » et « arrêt général ».
- **Lignes de texte** dans la conduite (réplique, mouvement, repère) : GO les saute, et le texte qui annonce la cue en attente est surligné.
- **Mode de transition** dans la barre du haut : superposer les sons, **fondu enchaîné** (durée réglable) ou couper le précédent.
- **Bandeau « En cours »** : tous les sons qui jouent, avec temps restant, pause, fondu et arrêt individuels.
- **Boutons de sécurité** : FONDU (durée réglable) et STOP général, **verrouillage** du mode spectacle.
- Trois vues : **Conduite**, **Mixte** (conduite + pads) et **Pads**, en paysage comme en portrait.
- Chronomètre de spectacle et horloge.
- Clavier ou pédale Bluetooth : `Espace` / `Page suivante` = GO, flèches = cue en attente, `Échap` = fondu, `Maj+Échap` = stop.

### Préparation

![Réglages d'un pad : couleur, volume, second appui, frise avec la forme d'onde](docs/reglages-pad.png)

- **Réglages par son** : nom, couleur, volume, comportement au second appui, boucle.
- **Frise avec la forme d'onde** : on fait glisser les poignées de début et de fin au doigt ; fondus et lecture en cours y sont dessinés.
- **Auto-cue** : place le début et la fin là où le son commence et s'arrête (retire les silences).
- **Fondus** d'entrée et de fin, **ducking** (baisse automatique des autres sons), arrêt des autres sons au départ d'une cue.
- **Projets** multiples, export et import dans un fichier `.jinglee` (un ZIP standard contenant `project.json` et les sons).
- Formats : MP3, M4A/AAC, WAV, AIFF, CAF, FLAC (selon ce que l'appareil sait lire).

## Installation sur une tablette

1. Ouvrez **https://mathgen44.github.io/jinglee/** :
   - sur iPad / iPhone dans **Safari**, touchez *Partager* → *Sur l'écran d'accueil* (un bandeau le rappelle tant que Jinglee n'est pas installé) ;
   - sur Android dans **Chrome**, touchez *Installer* dans le bandeau ou le menu ;
   - sur ordinateur dans Chrome ou Edge, cliquez sur l'icône d'installation dans la barre d'adresse.
2. Lancez Jinglee depuis l'icône : c'est cette version installée qui garde vos sons et fonctionne hors-ligne.
3. Touchez **✎ Édition**, puis une case vide ou **+ Sons** pour importer vos fichiers.

> Sur iOS, l'application installée et Safari ont des données séparées : importez vos sons depuis l'application installée
> (ou exportez votre projet depuis Safari et réimportez-le dans l'application).

### Mises à jour

L'application vérifie s'il existe une nouvelle version à chaque retour au premier plan et affiche un bandeau
**« Mettre à jour »**. Elle ne se recharge jamais seule, pour ne pas couper un son pendant un spectacle.
Le numéro de version est indiqué en bas du menu ☰.

### Conseils pour le spectacle

- Réglez le **verrouillage automatique** de la tablette sur **Jamais** : le son s'arrête si l'écran se verrouille.
  Jinglee empêche déjà la mise en veille (état visible dans *Menu → Réglages*), mais ce réglage reste la meilleure garantie.
- Activez le mode avion ou « Ne pas déranger » pour éviter les notifications sonores.
- **Verrouillez** l'application (cadenas) pendant la représentation : plus aucune modification possible par erreur.
- **Exportez** votre projet après chaque modification importante : c'est votre sauvegarde.
- Import depuis Google Drive ou un autre service : si vos MP3 apparaissent grisés dans le sélecteur,
  cochez *Menu → Réglages → Montrer tous les fichiers à l'import*. Jinglee vérifie alors lui-même chaque fichier.
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
changez la constante `CACHE` dans `sw.js` (et `VERSION` dans `js/main.js`) : c'est ce qui déclenche la mise à jour
sur les appareils déjà installés.

| Fichier | Rôle |
|---|---|
| `js/audio.js` | Moteur Web Audio : décodage, cache, voix, fondus, ducking |
| `js/show.js` | Logique de spectacle : pads, GO, enchaînements, transitions |
| `js/main.js` | État de l'application, écran principal, menus, mises à jour |
| `js/editor.js` | Fenêtre de réglage d'un pad ou d'une cue |
| `js/timeline.js` | Frise : forme d'onde, poignées, auto-cue |
| `js/model.js` | Modèle de données d'un projet |
| `js/db.js` | Stockage IndexedDB |
| `js/archive.js`, `js/zip.js` | Export / import `.jinglee` |
| `js/device.js` | Anti-veille, session audio iOS |
| `js/install.js` | Bandeau d'invitation à installer |
| `tools/make_assets.py` | Génère les icônes et `js/media.js` |
| `tools/screenshots.py` | Régénère les captures de `docs/` (ffmpeg + Chrome) |

Pour régénérer les médias embarqués (nécessite ffmpeg et Pillow) :

```bash
ffmpeg -f lavfi -i color=c=black:s=16x16:r=1 -t 2 -c:v libx264 -profile:v baseline -pix_fmt yuv420p -an assets/keepawake.mp4
ffmpeg -f lavfi -i anullsrc=r=22050:cl=mono -t 1 -c:a libmp3lame -b:a 32k assets/silence.mp3
python tools/make_assets.py
```

Pour régénérer les captures d'écran du README (nécessite ffmpeg et Google Chrome) :

```bash
python tools/screenshots.py
```

## Pistes pour la suite

- Cue « niveau » (baisser un son en cours sans l'arrêter)
- Playlist d'entracte (aléatoire, boucle)
- Auto-cue appliqué automatiquement à l'import, seuil réglable
- Télécommande depuis un téléphone, MIDI / OSC
- Pré-écoute sur une sortie séparée

## Licence

MIT — voir [LICENSE](LICENSE).
