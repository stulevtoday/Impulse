package com.example.model

import kotlin.io.println

data class User(val name: String) {
    fun display() = println(name)
}

private class InternalHelper
