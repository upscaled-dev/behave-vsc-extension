# language: fr
@feature_fr
Fonctionnalité: exécution française

  Contexte:
    Soit une préparation française

  @scenario_fr
  Scénario: scénario choisi
    Soit je commence "scénario"
    Alors j'enregistre "scénario"

  @outline_fr
  Plan du scénario: lignes choisies
    Soit je commence "<entrée>"
    Alors j'enregistre "<entrée>"

    @rows_fr
    Exemples: entrées
      | entrée |
      | un     |
      | deux   |
