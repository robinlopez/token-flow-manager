---
icon: lucide/palette
---

# Types de tokens & pickers

Token Flow Manager comprend les types de tokens DTCG et donne à chacun un éditeur
adapté, du simple champ texte au picker de couleur complet, ou à un éditeur structuré
pour les tokens composites.

![Tableau des variables avec des tokens couleur sur plusieurs modes](assets/screenshots/table-colors.webp)

## Types simples

Édités en ligne dans le tableau (double-clic sur une cellule, ou Entrée sur une cellule
sélectionnée) :

| Type | Éditeur |
|---|---|
| `color` | Picker de couleur (voir plus bas) |
| `dimension`, `number` | Champ texte avec incréments ↑/↓ |
| `fontFamily`, `fontWeight`, `duration` | Champ texte |
| `cubicBezier` | Quatre nombres `[x1, y1, x2, y2]` |
| `strokeStyle` | Texte / liste déroulante |

## Picker de couleur

Cliquez sur une cellule de couleur pour ouvrir le picker. Il a deux onglets : **Custom**
(saisir votre propre valeur) et **Libraries** (référencer un autre token).

=== "RGB"

    Carré saturation/valeur, curseurs de teinte et d'alpha, une pipette, et saisie HEX
    ou RGB.

    ![Picker de couleur, mode RGB](assets/screenshots/picker-rgb.webp)

=== "OKLCH"

    Curseurs de luminosité, chroma et teinte avec badges de gamut sRGB / P3 en direct,
    et sortie en OKLCH, Display P3 ou HEX.

    ![Picker de couleur, mode OKLCH](assets/screenshots/picker-oklch.webp)

=== "Libraries (alias)"

    Recherchez et choisissez un autre token à référencer. Les tokens couleur affichent
    une pastille et leur valeur résolue.

    ![Picker de couleur, onglet Libraries](assets/screenshots/picker-libraries.webp)

## Tokens composites

Les tokens composites (objets ou tableaux) ont un éditeur structuré **déplié sur
place**. Cliquez sur l'**icône curseurs** d'une cellule composite. Chaque champ reçoit
le bon contrôle : les champs couleur ouvrent le picker, les dimensions et nombres sont
des champs texte, et vous pouvez référencer chaque champ individuellement.

=== "Shadow"

    `color`, `offsetX`, `offsetY`, `blur`, `spread`.

    ![Éditeur composite Shadow](assets/screenshots/composite-shadow.webp)

=== "Gradient"

    Une barre de prévisualisation et une liste de stops (couleur + position), avec
    **Add stop**.

    ![Éditeur composite Gradient](assets/screenshots/composite-gradient.webp)

=== "Typography"

    `fontFamily`, `fontWeight`, `fontSize`, `lineHeight`, `letterSpacing` et plus.
    Chaque champ peut être une valeur littérale ou un alias.

    ![Éditeur composite Typography](assets/screenshots/composite-typography.webp)

`border` et `transition` fonctionnent de la même façon, chacun avec ses propres champs.
