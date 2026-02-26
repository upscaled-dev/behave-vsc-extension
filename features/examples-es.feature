# language: es
# -*- coding: utf-8 -*-
"""
Ejemplo de archivo feature en español para demostrar el soporte multilingüe
Behave VSCode Extension
"""

Característica: Sistema de reserva de hoteles
  Para realizar mis viajes de manera fácil
  Como viajero
  Quiero poder buscar, comparar y reservar habitaciones de hotel

  Antecedentes:
    Dado que estoy en la página de inicio del sistema de reservas
    Y la base de datos contiene varios hoteles disponibles
    Y el sistema de calendario está activo

  Escenario: Buscar hoteles disponibles
    Dado que estoy en la página de búsqueda
    Cuando ingreso "Madrid" como destino
    Y selecciono la fecha de entrada "2024-03-15"
    Y selecciono la fecha de salida "2024-03-20"
    Y selecciono "2 habitaciones"
    Y hago clic en "Buscar"
    Entonces debería ver una lista de hoteles disponibles
    Y cada hotel debería mostrar su precio por noche
    Y debería ver el número de habitaciones disponibles

  Escenario: Ver detalles del hotel
    Dado que tengo una lista de hoteles disponibles
    Cuando hago clic en el hotel "Gran Hotel Madrid"
    Entonces debería ver la información completa del hotel
    Y debería ver fotos de las habitaciones
    Y debería ver las opiniones de otros viajeros
    Y debería ver el mapa de ubicación

  Escenario: Realizar una reserva
    Dado que he seleccionado el hotel "Gran Hotel Madrid"
    Cuando hago clic en "Reservar ahora"
    Y ingreso mis datos personales
    Y selecciono el tipo de habitación "Habitación doble"
    Y selecciono servicios adicionales
    Y ingreso mis datos de pago
    Y hago clic en "Confirmar reserva"
    Entonces la reserva debería ser procesada
    Y debería recibir una confirmación por correo electrónico
    Y el número de reserva debería ser visible en mi cuenta

  Esquema del escenario: Validar búsqueda de hoteles por clasificación
    Dado que estoy buscando hoteles
    Cuando selecciono una clasificación mínima de "<estrellas>"
    Y realizo la búsqueda
    Entonces todos los resultados deberían tener al menos "<estrellas>" estrellas
    Y debería ver "<cantidad_resultados>" resultados

    Ejemplos:
      | estrellas | cantidad_resultados |
      | 3         | 45                  |
      | 4         | 28                  |
      | 5         | 12                  |
      | 2         | 78                  |

  Escenario: Cancelar una reserva
    Dado que tengo una reserva activa para el "Gran Hotel Madrid"
    Y mi número de reserva es "RES123456"
    Cuando accedo a mi perfil
    Y hago clic en "Cancelar reserva"
    Y confirmo la cancelación
    Entonces la reserva debería ser cancelada
    Y debería ver el reembolso pendiente
    Y debería recibir una confirmación de cancelación

  Escenario: Modificar una reserva existente
    Dado que tengo una reserva existente
    Cuando hago clic en "Modificar reserva"
    Y cambio la fecha de salida a "2024-03-25"
    Y cambio el número de habitaciones a "3"
    Y hago clic en "Actualizar"
    Entonces los cambios deberían ser guardados
    Y debería ver el nuevo precio total
    Y debería recibir una confirmación de los cambios

  Escenario: Buscar por servicios del hotel
    Dado que estoy realizando una búsqueda avanzada
    Cuando selecciono el filtro "Piscina"
    Y selecciono el filtro "Gimnasio"
    Y selecciono el filtro "Restaurante"
    Y realizo la búsqueda
    Entonces todos los hoteles resultantes deberían tener estos servicios
    Y debería ser capaz de ver qué servicios tiene cada hotel

  Escenario: Aplicar un código de descuento
    Dado que estoy en la página de pago
    Y tengo un código de descuento "VIAJERO2024"
    Cuando ingreso el código en el campo de descuento
    Y hago clic en "Aplicar"
    Entonces el descuento debería ser aplicado
    Y el precio total debería ser reducido
    Y debería ver el desglose del descuento
