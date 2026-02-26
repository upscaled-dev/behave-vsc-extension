# language: fr
# -*- coding: utf-8 -*-
"""
Exemple de fichier feature en français pour démontrer le support multilingue
Behave VSCode Extension
"""

Fonctionnalité: Gestion des produits dans un panier d'achat
  Afin de faire mes achats en ligne
  En tant que client
  Je veux ajouter, modifier et supprimer des produits de mon panier

  Contexte:
    Soit je suis connecté à mon compte
    Et le catalogue de produits est chargé
    Et mon panier est vide

  Scénario: Ajouter un produit au panier
    Soit je suis sur la page du produit "Ordinateur portable"
    Quand j'ajoute 1 unité au panier
    Alors le produit devrait être ajouté au panier
    Et le nombre d'articles dans le panier devrait être 1
    Et le prix total devrait être mis à jour

  Scénario: Augmenter la quantité d'un produit existant
    Soit mon panier contient 1 unité de "Souris sans fil"
    Quand j'augmente la quantité à 3
    Alors la quantité devrait être 3
    Et le prix total devrait être recalculé

  Scénario: Retirer un produit du panier
    Soit mon panier contient les produits suivants:
      | produit           | quantité |
      | Clavier mécanique | 1        |
      | Moniteur 4K       | 1        |
    Quand je supprime le produit "Clavier mécanique"
    Alors le produit devrait être retiré du panier
    Et le nombre d'articles devrait être 1

  Scénario-modèle: Ajouter différents types de produits
    Soit je suis sur la page du produit "<produit>"
    Quand j'ajoute <quantité> unité(s) au panier
    Alors le produit devrait être dans le panier
    Et le prix total devrait être "<prix_total>"

    Exemples:
      | produit              | quantité | prix_total |
      | Ordinateur portable  | 1        | 1500,00€   |
      | Souris sans fil      | 2        | 80,00€     |
      | Clavier mécanique    | 1        | 150,00€    |
      | Moniteur 4K          | 1        | 600,00€    |

  Scénario: Appliquer un code de réduction
    Soit mon panier contient un produit d'une valeur de 100,00€
    Quand j'applique le code de réduction "REDUCTION50"
    Alors une réduction de 50% devrait être appliquée
    Et le prix total devrait devenir 50,00€
    Et le code de réduction devrait être visible dans le panier

  Scénario: Procéder au paiement
    Soit mon panier contient plusieurs produits
    Et le prix total est calculé correctement
    Quand je clique sur "Procéder au paiement"
    Alors je suis redirigé vers la page de paiement
    Et mes informations client sont préremplies
    Et l'option de livraison est disponible

  Scénario: Vider le panier
    Soit mon panier contient plusieurs produits
    Quand je clique sur "Vider le panier"
    Et je confirme l'action
    Alors tous les produits doivent être supprimés
    Et le message "Votre panier est vide" devrait s'afficher
    Et je suis redirigé vers le catalogue
